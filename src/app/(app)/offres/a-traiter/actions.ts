"use server";

import { refresh } from "next/cache";
import { requireUser } from "@/lib/auth/dal";
import { getMatchRequestDeps } from "@/lib/matching-deps";
import { requestMissingMatches } from "@/modules/matching";

/** Scores manquants ou périmés des offres à traiter : 50 matchings au plus par clic (quotas IA). */
export async function requestMissingMatchesAction(): Promise<{ error?: string } | void> {
  const user = await requireUser();
  const n = await requestMissingMatches(getMatchRequestDeps(), user.id, 50);
  if (n === 0) return { error: "Aucun score à calculer : valide ton profil maître, ou les scores sont déjà à jour." };
  refresh();
}
