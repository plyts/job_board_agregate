"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getSourcesDeps } from "@/lib/sources-deps";
import { getBoss, logger, savedSearchJobOptions } from "@/modules/platform";
import { CONTRACTS, createSavedSearch, deleteSavedSearch, importSearchResults, runCombinedSearch, setSavedSearchActive } from "@/modules/sources";

export type SearchFormState = { error?: string; ok?: string; values?: Record<string, string | string[]> };

const Id = z.uuid();
const Query = z.object({
  keywords: z.string().trim().min(2, "Indique au moins un mot-clé.").max(200),
  location: z.string().trim().max(100),
  radiusKm: z.coerce.number().int().min(0).max(100),
  contracts: z.array(z.enum(Object.keys(CONTRACTS) as [string, ...string[]])),
  publishedWithinDays: z.coerce.number().int().refine((d) => [1, 3, 7, 14, 31].includes(d)),
  sourceIds: z.array(z.uuid()),
});

function read(f: FormData) {
  const values = {
    keywords: String(f.get("keywords") ?? ""),
    location: String(f.get("location") ?? ""),
    radiusKm: String(f.get("radiusKm") ?? "0"),
    publishedWithinDays: String(f.get("publishedWithinDays") ?? "7"),
    contracts: f.getAll("contracts").map(String),
    sourceIds: f.getAll("sourceIds").map(String),
  };
  return { values, parsed: Query.safeParse(values) };
}

/** Recherche ponctuelle sur les sources choisies ; les résultats s'affichent sur /recherche?run=… */
export async function runSearchAction(_prev: SearchFormState, f: FormData): Promise<SearchFormState> {
  const user = await requireUser();
  const { values, parsed } = read(f);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Critères invalides.", values };
  const q = parsed.data;
  const run = await runCombinedSearch(getSourcesDeps(), user.id, { keywords: q.keywords, location: q.location || null, radiusKm: q.radiusKm || null, contracts: q.contracts, publishedWithinDays: q.publishedWithinDays, limit: 150 }, q.sourceIds);
  if (!run.sources) return { error: "Aucune source interrogeable : connecte France Travail, Adzuna ou une page carrières dans « Sources ».", values };
  redirect(`/recherche?run=${run.runId}`);
}

const Saved = z.object({
  name: z.string().trim().min(1, "Donne un nom à la recherche.").max(80),
  intervalHours: z.coerce.number().int().refine((h) => [3, 6, 12, 24].includes(h)),
  maxPerRun: z.coerce.number().int().min(1).max(100),
});

export async function saveSearchAction(_prev: SearchFormState, f: FormData): Promise<SearchFormState> {
  const user = await requireUser();
  const { values, parsed } = read(f);
  const saved = Saved.safeParse({ name: f.get("name"), intervalHours: f.get("intervalHours"), maxPerRun: f.get("maxPerRun") });
  const all = { ...values, name: String(f.get("name") ?? ""), intervalHours: String(f.get("intervalHours") ?? "6"), maxPerRun: String(f.get("maxPerRun") ?? "20") };
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Critères invalides.", values: all };
  if (!saved.success) return { error: saved.error.issues[0]?.message ?? "Réglages invalides.", values: all };
  const q = parsed.data;
  await createSavedSearch(getDb(), user.id, {
    name: saved.data.name,
    keywords: q.keywords,
    location: q.location || null,
    radiusKm: q.radiusKm || null,
    contracts: q.contracts,
    publishedWithinDays: q.publishedWithinDays,
    sourceIds: q.sourceIds,
    intervalHours: saved.data.intervalHours,
    maxPerRun: saved.data.maxPerRun,
  });
  refresh();
  return { ok: `Recherche « ${saved.data.name} » enregistrée : elle sera lancée toutes les ${saved.data.intervalHours} h.`, values: all };
}

export async function importResultsAction(runId: string, indices: number[]): Promise<{ error?: string; ok?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(runId).success || !Array.isArray(indices) || indices.length === 0 || indices.length > 200) return { error: "Choisis au moins une offre." };
  const summary = await importSearchResults(getSourcesDeps(), user.id, runId, indices.map(Number));
  if (!summary) return { error: "Recherche introuvable : relance-la." };
  refresh();
  const parts = [
    `${summary.created} offre${summary.created > 1 ? "s" : ""} importée${summary.created > 1 ? "s" : ""}`,
    summary.incomplete ? `dont ${summary.incomplete} à compléter` : "",
    summary.duplicates ? `${summary.duplicates} déjà connue${summary.duplicates > 1 ? "s" : ""}` : "",
  ].filter(Boolean);
  return { ok: `${parts.join(", ")}.` };
}

export async function setSavedSearchActiveAction(id: string, active: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!(await setSavedSearchActive(getDb(), user.id, id, active))) return { error: "Recherche introuvable." };
  refresh();
  return {};
}

export async function deleteSavedSearchAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!(await deleteSavedSearch(getDb(), user.id, id))) return { error: "Recherche introuvable." };
  refresh();
  return {};
}

/** Exécution immédiate d'une recherche enregistrée par le worker. */
export async function runSavedSearchNowAction(id: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(id).success) return { error: "Recherche introuvable." };
  try {
    const boss = await getBoss();
    await boss.send("sources.search", { searchId: id, userId: user.id }, savedSearchJobOptions(id));
  } catch (err) {
    logger.error({ err }, "recherche enregistrée non mise en file");
    return { error: "La demande n'a pas pu être enregistrée." };
  }
  refresh();
  return {};
}
