"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getSourcesDeps } from "@/lib/sources-deps";
import { getBoss, logger, mailboxJobOptions, secretsConfigured } from "@/modules/platform";
import { connectAdzuna, connectCareerPage, connectEmailAlerts, connectFranceTravail, removeSource, setSourceActive, type ConnectResult } from "@/modules/sources";

/** `values` : saisie rendue au formulaire après une erreur (jamais les secrets). */
export type SourceFormState = { error?: string; ok?: boolean; values?: Record<string, string> };

const Id = z.uuid();
const field = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" ? v : "";
};

function done(result: ConnectResult, values: Record<string, string>): SourceFormState {
  if (!result.ok) return { error: result.error, values };
  refresh();
  return { ok: true };
}

const NO_KEY = "Le chiffrement des identifiants n'est pas configuré : ajoute JOBPILOT_SECRETS_KEY à l'environnement (voir .env.example), puis redémarre.";

export async function connectFranceTravailAction(_prev: SourceFormState, f: FormData): Promise<SourceFormState> {
  const user = await requireUser();
  if (!secretsConfigured()) return { error: NO_KEY };
  const values = { clientId: field(f, "clientId").slice(0, 200) };
  return done(await connectFranceTravail(getSourcesDeps(), user.id, { clientId: values.clientId, clientSecret: field(f, "clientSecret").slice(0, 500) }), values);
}

export async function connectAdzunaAction(_prev: SourceFormState, f: FormData): Promise<SourceFormState> {
  const user = await requireUser();
  if (!secretsConfigured()) return { error: NO_KEY };
  const values = { appId: field(f, "appId").slice(0, 200) };
  return done(await connectAdzuna(getSourcesDeps(), user.id, { appId: values.appId, appKey: field(f, "appKey").slice(0, 500) }), values);
}

export async function connectCareerPageAction(_prev: SourceFormState, f: FormData): Promise<SourceFormState> {
  const user = await requireUser();
  const values = { url: field(f, "url").slice(0, 500), company: field(f, "company").slice(0, 120) };
  return done(await connectCareerPage(getSourcesDeps(), user.id, values), values);
}

const Email = z.object({
  host: z.string().trim().min(3).max(253),
  security: z.enum(["tls", "starttls"]),
  port: z.coerce.number().int().min(1).max(65535),
  user: z.string().trim().min(3).max(254),
  folder: z.string().trim().max(200),
});

export async function connectEmailAlertsAction(_prev: SourceFormState, f: FormData): Promise<SourceFormState> {
  const user = await requireUser();
  if (!secretsConfigured()) return { error: NO_KEY };
  const values = { host: field(f, "host"), security: field(f, "security"), port: field(f, "port"), user: field(f, "user"), folder: field(f, "folder"), autoFetch: f.get("autoFetch") ? "on" : "" };
  const parsed = Email.safeParse(values);
  if (!parsed.success) return { error: "Serveur, port, sécurité ou adresse invalide.", values };
  const result = await connectEmailAlerts(getSourcesDeps(), user.id, {
    host: parsed.data.host,
    port: parsed.data.port,
    secure: parsed.data.security === "tls",
    user: parsed.data.user,
    password: field(f, "password").slice(0, 500),
    folder: parsed.data.folder || "INBOX",
    autoFetch: values.autoFetch === "on",
  });
  return done(result, values);
}

export async function removeSourceAction(sourceId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(sourceId).success || !(await removeSource(getDb(), user.id, sourceId))) return { error: "Source introuvable." };
  refresh();
  return {};
}

export async function setSourceActiveAction(sourceId: string, active: boolean): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(sourceId).success || !(await setSourceActive(getDb(), user.id, sourceId, active))) return { error: "Source introuvable." };
  refresh();
  return {};
}

/** Lecture immédiate de la boîte d'alertes par le worker. */
export async function syncMailboxNowAction(sourceId: string): Promise<{ error?: string }> {
  const user = await requireUser();
  if (!Id.safeParse(sourceId).success) return { error: "Source introuvable." };
  try {
    const boss = await getBoss();
    await boss.send("sources.mailbox", { sourceId, userId: user.id }, mailboxJobOptions(sourceId));
  } catch (err) {
    logger.error({ err }, "lecture des alertes non mise en file");
    return { error: "La demande n'a pas pu être enregistrée." };
  }
  refresh();
  return {};
}
