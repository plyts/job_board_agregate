"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getProfileDeps } from "@/lib/profile-deps";
import { logger } from "@/modules/platform";
import { discardDraft, importCv, resolveUncertainty, saveDraft, startDraft, validateDraft } from "@/modules/profile";

export type ImportCvState = { error?: string };

export async function importCvAction(_prev: ImportCvState, formData: FormData): Promise<ImportCvState> {
  const user = await requireUser();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choisis un CV au format PDF ou DOCX." };
  let result;
  try {
    result = await importCv(getProfileDeps(), user.id, Buffer.from(await file.arrayBuffer()));
  } catch (err) {
    logger.error({ err, userId: user.id }, "import de CV en échec");
    return { error: "L'import a échoué. Réessaie dans un instant." };
  }
  if (!result.ok) return { error: result.error };
  redirect("/profil/brouillon");
}

export async function startDraftAction(): Promise<void> {
  const user = await requireUser();
  await startDraft(getDb(), user.id);
  redirect("/profil/brouillon");
}

export type SaveDraftState = { error?: string; saved?: boolean };

export async function saveDraftAction(content: unknown): Promise<SaveDraftState> {
  const user = await requireUser();
  const result = await saveDraft(getDb(), user.id, content);
  return result.ok ? { saved: true } : { error: result.error };
}

export type ValidateState = { problems?: string[] };

export async function validateDraftAction(): Promise<ValidateState> {
  const user = await requireUser();
  const result = await validateDraft(getDb(), user.id);
  if (!result.ok) return { problems: result.problems };
  redirect("/profil");
}

export async function discardDraftAction(): Promise<void> {
  const user = await requireUser();
  await discardDraft(getDb(), user.id);
  redirect("/profil");
}

export async function resolveUncertaintyAction(uncertaintyId: string): Promise<void> {
  const user = await requireUser();
  if (typeof uncertaintyId !== "string" || uncertaintyId.length > 40) return;
  await resolveUncertainty(getDb(), user.id, uncertaintyId);
  refresh();
}
