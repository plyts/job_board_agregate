"use server";

import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { getMatchRequestDeps } from "@/lib/matching-deps";
import { parseWeights, requestMatch, updateWeights } from "@/modules/matching";

const Id = z.uuid();

export type RequestMatchState = { error?: string };

export async function requestMatchAction(offerId: string): Promise<RequestMatchState> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return { error: "Offre inconnue." };
  const result = await requestMatch(getMatchRequestDeps(), user.id, offerId);
  if (!result.ok) return { error: result.message };
  redirect(`/offres/${offerId}/matching`);
}

export type WeightsState = { error?: string };

export async function updateWeightsAction(matchId: string, _prev: WeightsState, formData: FormData): Promise<WeightsState> {
  const user = await requireUser();
  if (!Id.safeParse(matchId).success) return { error: "Matching inconnu." };
  const weights = parseWeights(Object.fromEntries(formData));
  if (!weights) return { error: "Chaque poids doit être compris entre 0 et 100, et au moins un doit être positif." };
  const score = await updateWeights(getDb(), user.id, matchId, weights);
  if (score === undefined) return { error: "Matching introuvable ou pas encore terminé." };
  refresh();
  return {};
}
