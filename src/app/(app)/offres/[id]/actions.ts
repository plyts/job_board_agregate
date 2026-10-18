"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import { getDb } from "@/db/client";
import { requireUser } from "@/lib/auth/dal";
import { correctRequirement, decideOffer, requeueFailedOffer } from "@/modules/analysis";
import { analysisJobOptions, getBoss } from "@/modules/platform";

const Id = z.uuid();

const Correction = z.object({
  label: z.string().trim().min(1).max(200),
  value: z.string().trim().max(300).transform((v) => v || null),
  importance: z.enum(["mandatory", "preferred", "condition"]),
});

export type CorrectionState = { error?: string; saved?: boolean };

export async function correctRequirementAction(requirementId: string, _prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  const user = await requireUser();
  if (!Id.safeParse(requirementId).success) return { error: "Exigence inconnue." };
  const parsed = Correction.safeParse({ label: formData.get("label"), value: formData.get("value") ?? "", importance: formData.get("importance") });
  if (!parsed.success) return { error: "Renseigne au moins un intitulé (200 caractères maximum)." };
  if (!(await correctRequirement(getDb(), user.id, requirementId, parsed.data))) return { error: "Exigence inconnue." };
  refresh();
  return { saved: true };
}

export async function removeRequirementAction(requirementId: string): Promise<void> {
  const user = await requireUser();
  if (!Id.safeParse(requirementId).success) return;
  await correctRequirement(getDb(), user.id, requirementId, { removed: true });
  refresh();
}

export async function decideOfferAction(offerId: string, decision: "qualify" | "discard"): Promise<void> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success || (decision !== "qualify" && decision !== "discard")) return;
  await decideOffer(getDb(), user.id, offerId, decision);
  refresh();
}

export async function retryAnalysisAction(offerId: string): Promise<void> {
  const user = await requireUser();
  if (!Id.safeParse(offerId).success) return;
  if (await requeueFailedOffer(getDb(), user.id, offerId)) {
    const boss = await getBoss();
    await boss.send("offer.analyze", { offerId, userId: user.id }, analysisJobOptions(offerId));
  }
  refresh();
}
