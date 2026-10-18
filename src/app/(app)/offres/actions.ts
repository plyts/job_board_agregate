"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/dal";
import { getOfferDeps } from "@/lib/offers-deps";
import { importOffer, type OfferImportInput } from "@/modules/offers/service";
import { logger } from "@/modules/platform";

export type ImportState = {
  status: "idle" | "error" | "duplicate";
  message?: string;
  offerId?: string;
  /** Vrai quand la page n'a pas pu être récupérée : l'utilisateur colle le texte, l'URL est conservée. */
  suggestText?: boolean;
  url?: string;
  text?: string;
};

const Mode = z.enum(["url", "text", "file"]);

export async function importOfferAction(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const user = await requireUser();
  const mode = Mode.safeParse(formData.get("mode"));
  if (!mode.success) return { status: "error", message: "Mode d'import inconnu." };

  const url = typeof formData.get("url") === "string" ? String(formData.get("url")).trim() : "";
  const text = typeof formData.get("text") === "string" ? String(formData.get("text")) : "";
  let input: OfferImportInput;
  if (mode.data === "url") {
    if (!url) return { status: "error", message: "Renseigne l'URL de l'annonce." };
    input = { kind: "url", url };
  } else if (mode.data === "text") {
    if (!text.trim()) return { status: "error", message: "Colle le texte de l'annonce.", url };
    input = { kind: "text", text, url: url || null };
  } else {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) return { status: "error", message: "Choisis un fichier PDF ou texte." };
    input = { kind: "file", bytes: Buffer.from(await file.arrayBuffer()) };
  }

  let result;
  try {
    result = await importOffer(getOfferDeps(), user.id, input);
  } catch (err) {
    logger.error({ err, userId: user.id, mode: mode.data }, "import d'offre en échec");
    return { status: "error", message: "L'import a échoué. Réessaie dans un instant.", url, text };
  }
  if (!result.ok) {
    const suggestText = result.code === "FETCH_NOT_ALLOWED" || result.code === "FETCH_FAILED";
    return { status: "error", message: result.message, suggestText, url, text };
  }
  if (result.duplicate) {
    refresh();
    return { status: "duplicate", message: "Cette offre est déjà dans ta liste.", offerId: result.offerId };
  }
  redirect(`/offres/${result.offerId}`);
}
