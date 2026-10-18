"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, getPool } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getCvSuggestDeps } from "@/lib/cv-deps";
import { getMatchRequestDeps } from "@/lib/matching-deps";
import {
  acceptSuggestion,
  finalizeCvVersion,
  getCvVersion,
  recheckCv,
  rejectSuggestion,
  requestSuggestions,
  resetCvFromProfile,
  restoreCvVersion,
  saveCvDraft,
  startCvDraft,
  undoSuggestion,
} from "@/modules/cv";

const Id = z.uuid();

export type CvActionState = { error?: string; ok?: boolean };

export async function startCvDraftAction(offerId: string): Promise<CvActionState> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return { error: "Offre inconnue." };
  const result = await startCvDraft(getDb(), user.id, offerId);
  if (!result.ok) return { error: result.message };
  redirect(`/offres/${offerId}/cv`);
}

export async function saveCvDraftAction(offerId: string, revision: number, content: unknown): Promise<CvActionState & { revision?: number }> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success || !Number.isInteger(revision)) return { error: "Requête invalide." };
  const result = await saveCvDraft(getDb(), user.id, offerId, revision, content);
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true, revision: result.revision };
}

export async function resetCvFromProfileAction(offerId: string): Promise<CvActionState> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return { error: "Offre inconnue." };
  const result = await resetCvFromProfile(getDb(), user.id, offerId);
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

export async function restoreCvVersionAction(offerId: string, versionId: string): Promise<CvActionState> {
  const user = await requireUser();
  if (!Id.safeParse(versionId).success || !Id.safeParse(offerId).success) return { error: "Version inconnue." };
  const version = await getCvVersion(getDb(), user.id, versionId);
  if (!version || version.offerId !== offerId) return { error: "Version inconnue." };
  const result = await restoreCvVersion(getDb(), user.id, versionId);
  if (!result.ok) return { error: result.error };
  redirect(`/offres/${offerId}/cv`);
}

export async function requestSuggestionsAction(offerId: string): Promise<CvActionState> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return { error: "Offre inconnue." };
  const result = await requestSuggestions(getCvSuggestDeps(), user.id, offerId);
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

const Decision = z.object({
  suggestionId: z.uuid(),
  decision: z.enum(["accept", "reject", "undo"]),
  text: z.string().max(1500).optional(),
});

export async function decideSuggestionAction(input: z.input<typeof Decision>): Promise<CvActionState> {
  const user = await requireUser();
  const parsed = Decision.safeParse(input);
  if (!parsed.success) return { error: "Requête invalide." };
  const { suggestionId, decision, text } = parsed.data;
  const result =
    decision === "accept"
      ? await acceptSuggestion(getPool(), user.id, suggestionId, text)
      : decision === "reject"
        ? await rejectSuggestion(getDb(), user.id, suggestionId)
        : await undoSuggestion(getPool(), user.id, suggestionId);
  refresh();
  return result.ok ? { ok: true } : { error: result.error };
}

export async function recheckCvAction(offerId: string): Promise<CvActionState> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return { error: "Offre inconnue." };
  const result = await recheckCv(getMatchRequestDeps(), user.id, offerId);
  if (!result.ok) return { error: result.error };
  redirect(`/offres/${offerId}/cv/recontrole/${result.versionId}`);
}

export type FinalizeState = { problems?: string[]; ok?: boolean };

export async function finalizeCvAction(versionId: string): Promise<FinalizeState> {
  const user = await requireUser();
  if (!Id.safeParse(versionId).success) return { problems: ["Version inconnue."] };
  const result = await finalizeCvVersion(getDb(), user.id, versionId);
  if (!result.ok) return { problems: result.problems };
  refresh();
  return { ok: true };
}
