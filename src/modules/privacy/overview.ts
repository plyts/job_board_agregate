import { and, count, eq, inArray, max, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { llmCalls } from "@/db/schema";

/** Traitements qui envoient des données personnelles (masquées) à un modèle : la liste du registre (docs/RGPD.md). */
export const PERSONAL_PURPOSES = ["profile.extract", "match.judge", "cv.suggest", "letter.draft"] as const;

export type PersonalDataTransfer = { provider: string; calls: number; masked: number; removedFromOutput: number; lastAt: Date | null };

/** Envois réussis de données personnelles aux IA, par fournisseur : décomptes de masquage, jamais les valeurs. */
export async function personalDataStats(db: Db, userId: string) {
  const rows = await db
    .select({
      provider: llmCalls.provider,
      calls: count(),
      masked: sum(llmCalls.piiMasked),
      inOutput: sum(llmCalls.piiInOutput),
      lastAt: max(llmCalls.createdAt),
    })
    .from(llmCalls)
    .where(and(eq(llmCalls.userId, userId), eq(llmCalls.status, "ok"), inArray(llmCalls.purpose, [...PERSONAL_PURPOSES])))
    .groupBy(llmCalls.provider);
  const byProvider: PersonalDataTransfer[] = rows
    .map((r) => ({ provider: r.provider, calls: r.calls, masked: Number(r.masked ?? 0), removedFromOutput: Number(r.inOutput ?? 0), lastAt: r.lastAt }))
    .sort((a, b) => b.calls - a.calls);
  return {
    calls: byProvider.reduce((s, r) => s + r.calls, 0),
    maskedAtBoundary: byProvider.reduce((s, r) => s + r.masked, 0),
    removedFromOutput: byProvider.reduce((s, r) => s + r.removedFromOutput, 0),
    byProvider,
  };
}
