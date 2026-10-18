"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb, getPool } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getApplicationsDeps, getLetterDeps } from "@/lib/applications-deps";
import {
  acceptLetterProposal,
  addContact,
  APPLICATION_STATUSES,
  CHANNELS,
  confirmSend,
  createApplication,
  deleteContact,
  discardLetterProposal,
  moveApplication,
  requestLetterDraft,
  saveCoverLetter,
  saveNotes,
  setNextAction,
} from "@/modules/applications";
import { logger } from "@/modules/platform";

const Id = z.uuid();

/** `values` : saisie rendue au formulaire après une erreur (React réinitialise les champs non contrôlés). */
export type ApplicationActionState = { error?: string; ok?: boolean; values?: Record<string, string> };

export async function createApplicationAction(offerId: string): Promise<ApplicationActionState> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return { error: "Offre inconnue." };
  const result = await createApplication(getDb(), getPool(), user.id, offerId);
  if (!result.ok && !result.applicationId) return { error: result.message };
  redirect(`/candidatures/${result.ok ? result.applicationId : result.applicationId}`);
}

const Move = z.object({ id: z.uuid(), to: z.enum(APPLICATION_STATUSES) });

export async function moveApplicationAction(input: z.input<typeof Move>): Promise<ApplicationActionState> {
  const user = await requireUser();
  const parsed = Move.safeParse(input);
  if (!parsed.success) return { error: "Requête invalide." };
  const result = await moveApplication(getPool(), user.id, parsed.data.id, parsed.data.to);
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

const Day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const Send = z.object({
  sentAt: Day,
  channel: z.enum(Object.keys(CHANNELS) as [keyof typeof CHANNELS, ...(keyof typeof CHANNELS)[]]),
  file: z.string().min(1),
});

export async function confirmSendAction(applicationId: string, _prev: ApplicationActionState, formData: FormData): Promise<ApplicationActionState> {
  const user = await requireUser();
  if (!Id.safeParse(applicationId).success) return { error: "Candidature inconnue." };
  const parsed = Send.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: "Renseigne la date d'envoi, le canal et le fichier envoyé." };
  let file;
  if (parsed.data.file === "upload") {
    const upload = formData.get("upload");
    if (!(upload instanceof File) || upload.size === 0) return { error: "Choisis le fichier que tu as envoyé (PDF ou DOCX)." };
    file = { kind: "upload" as const, fileName: upload.name, bytes: Buffer.from(await upload.arrayBuffer()) };
  } else {
    if (!Id.safeParse(parsed.data.file).success) return { error: "Version de CV inconnue." };
    file = { kind: "cv_version" as const, cvVersionId: parsed.data.file };
  }
  try {
    const result = await confirmSend(getApplicationsDeps(), user.id, applicationId, {
      sentAt: parsed.data.sentAt,
      channel: parsed.data.channel,
      file,
      attachLetter: formData.get("attachLetter") === "on",
    });
    if (!result.ok) return { error: result.error };
  } catch (err) {
    logger.error({ err, userId: user.id }, "confirmation d'envoi en échec");
    return { error: "La confirmation a échoué. Réessaie dans un instant." };
  }
  refresh();
  return { ok: true };
}

const NextAction = z.object({
  nextAction: z.string().trim().max(200),
  nextActionAt: z.union([Day, z.literal("")]),
  followUpDays: z.enum(["", "7", "10", "14"]),
});

export async function setNextActionAction(applicationId: string, _prev: ApplicationActionState, formData: FormData): Promise<ApplicationActionState> {
  const user = await requireUser();
  const parsed = NextAction.safeParse(Object.fromEntries(formData));
  if (!Id.safeParse(applicationId).success || !parsed.success) return { error: "Action ou date invalide." };
  const { nextAction, nextActionAt, followUpDays } = parsed.data;
  const result = await setNextAction(getPool(), user.id, applicationId, {
    nextAction: nextAction || null,
    nextActionAt: nextActionAt || null,
    followUpDays: followUpDays ? Number(followUpDays) : null,
  });
  if (!result.ok) return { error: result.error };
  refresh();
  return { ok: true };
}

export async function saveNotesAction(applicationId: string, _prev: ApplicationActionState, formData: FormData): Promise<ApplicationActionState> {
  const user = await requireUser();
  const notes = formData.get("notes");
  if (!Id.safeParse(applicationId).success || typeof notes !== "string" || notes.length > 10_000) return { error: "Notes invalides (10 000 caractères maximum)." };
  if (!(await saveNotes(getDb(), user.id, applicationId, notes))) return { error: "Candidature introuvable." };
  refresh();
  return { ok: true };
}

export async function saveCoverLetterAction(applicationId: string, _prev: ApplicationActionState, formData: FormData): Promise<ApplicationActionState> {
  const user = await requireUser();
  const text = formData.get("coverLetter");
  if (!Id.safeParse(applicationId).success || typeof text !== "string" || text.length > 8000) return { error: "Lettre invalide (8 000 caractères maximum)." };
  if (!(await saveCoverLetter(getDb(), user.id, applicationId, text))) return { error: "Candidature introuvable." };
  refresh();
  return { ok: true };
}

/** Demande au modèle une proposition de lettre (profil masqué, fournisseur autorisé et consenti). */
export async function requestLetterDraftAction(applicationId: string): Promise<ApplicationActionState> {
  const user = await requireUser();
  if (!Id.safeParse(applicationId).success) return { error: "Candidature inconnue." };
  const r = await requestLetterDraft(getLetterDeps(), user.id, applicationId);
  if (!r.ok) return { error: r.error };
  refresh();
  return { ok: true };
}

export async function decideLetterProposalAction(applicationId: string, decision: "accept" | "discard"): Promise<ApplicationActionState> {
  const user = await requireUser();
  if (!Id.safeParse(applicationId).success) return { error: "Candidature inconnue." };
  if (decision === "accept") {
    const r = await acceptLetterProposal(getDb(), user.id, applicationId);
    if (!r.ok) return { error: r.error };
  } else if (!(await discardLetterProposal(getDb(), user.id, applicationId))) return { error: "Candidature introuvable." };
  refresh();
  return { ok: true };
}

const optional = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v || null);

const Contact = z.object({
  name: z.string().trim().min(1, "Nom requis").max(120),
  role: optional(120),
  email: z.union([z.literal(""), z.string().trim().pipe(z.email())]).transform((v) => v || null),
  phone: optional(40),
  url: z.union([z.literal(""), z.url({ protocol: /^https?$/ })]).transform((v) => v || null),
  note: optional(500),
});

export async function addContactAction(applicationId: string, _prev: ApplicationActionState, formData: FormData): Promise<ApplicationActionState> {
  const user = await requireUser();
  const raw = Object.fromEntries(formData);
  const parsed = Contact.safeParse(raw);
  if (!Id.safeParse(applicationId).success) return { error: "Candidature inconnue." };
  if (!parsed.success) {
    const values = Object.fromEntries(Object.entries(raw).filter((e): e is [string, string] => typeof e[1] === "string"));
    return { error: parsed.error.issues[0]?.message === "Nom requis" ? "Le nom du contact est requis." : "E-mail ou lien invalide.", values };
  }
  if (!(await addContact(getDb(), user.id, applicationId, parsed.data))) return { error: "Candidature introuvable." };
  refresh();
  return { ok: true };
}

export async function deleteContactAction(contactId: string): Promise<ApplicationActionState> {
  const user = await requireUser();
  if (!Id.safeParse(contactId).success || !(await deleteContact(getDb(), user.id, contactId))) return { error: "Contact introuvable." };
  refresh();
  return { ok: true };
}
