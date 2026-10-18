import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { jobOffers, jobRequirements, llmCalls, offerAnalyses, requirementCorrections } from "@/db/schema";
import { withTransaction } from "@/db/transaction";
import { provisionalTitle, upsertCompany } from "@/modules/offers";
import { generateJournaled } from "@/modules/platform/llm/journal";
import { LlmError, type LlmClient } from "@/modules/platform/llm/types";
import { buildExtractionUserMessage, EXTRACTION_PROMPT_VERSION, EXTRACTION_SYSTEM } from "./prompt";
import { EXTRACTION_SCHEMA_VERSION, OfferExtraction } from "./schema";
import { verifyExtraction } from "./verify";

export type AnalysisDeps = { db: Db; pool: Pool; llm: LlmClient; budgetUsd?: number };

export type AnalysisOutcome =
  | { kind: "analyzed"; analysisId: string; requirements: number }
  | { kind: "skipped"; reason: "missing" | "already_done" }
  | { kind: "deferred"; reason: string }
  | { kind: "failed"; reason: string };

const DONE = ["analyzed", "qualified", "discarded"] as const;

async function setStatus(db: Db, offerId: string, status: "queued" | "analyzing" | "failed", reason: string | null) {
  await db.update(jobOffers).set({ status, statusReason: reason, updatedAt: new Date() }).where(eq(jobOffers.id, offerId));
}

/**
 * Analyse une offre : extraction par le modèle, contrôle des citations, enregistrement d'une nouvelle
 * version d'analyse. Idempotent : une offre déjà analysée n'est pas réanalysée.
 * Lève une erreur uniquement quand un nouvel essai automatique a une chance d'aboutir.
 */
export async function analyzeOffer(
  deps: AnalysisDeps,
  job: { offerId: string; userId: string },
  attempt: { isFinal: boolean } = { isFinal: false },
): Promise<AnalysisOutcome> {
  const { db } = deps;
  const [offer] = await db
    .select()
    .from(jobOffers)
    .where(and(eq(jobOffers.id, job.offerId), eq(jobOffers.userId, job.userId)))
    .limit(1);
  if (!offer) return { kind: "skipped", reason: "missing" };
  if ((DONE as readonly string[]).includes(offer.status)) return { kind: "skipped", reason: "already_done" };

  await setStatus(db, offer.id, "analyzing", null);
  let result;
  try {
    result = await generateJournaled(
      db,
      deps.llm,
      job.userId,
      {
        purpose: "offer.extract",
        promptVersion: EXTRACTION_PROMPT_VERSION,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        system: EXTRACTION_SYSTEM,
        user: buildExtractionUserMessage(offer.rawText),
        schema: OfferExtraction,
        maxTokens: 16000,
        effort: "medium",
      },
      { budgetUsd: deps.budgetUsd },
    );
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    if (err.code === "budget_exceeded") {
      const reason = "Budget IA du jour atteint : l'analyse reprendra automatiquement.";
      await setStatus(db, offer.id, "queued", reason);
      return { kind: "deferred", reason };
    }
    if (err.retryable && !attempt.isFinal) {
      await setStatus(db, offer.id, "failed", `Échec temporaire (${err.message}) : nouvel essai automatique.`);
      throw err;
    }
    const reason = err.code === "refused" ? "Le modèle a refusé d'analyser ce contenu." : `Analyse impossible : ${err.message}.`;
    await setStatus(db, offer.id, "failed", reason);
    return { kind: "failed", reason };
  }

  const verified = verifyExtraction(offer.rawText, result.output);
  const analysisId = await withTransaction(deps.pool, async (tx) => {
    await tx.db
      .update(offerAnalyses)
      .set({ state: "superseded" })
      .where(and(eq(offerAnalyses.offerId, offer.id), eq(offerAnalyses.state, "current")));
    const [analysis] = await tx.db
      .insert(offerAnalyses)
      .values({
        userId: job.userId,
        offerId: offer.id,
        schemaVersion: EXTRACTION_SCHEMA_VERSION,
        promptVersion: EXTRACTION_PROMPT_VERSION,
        model: result.model,
        llmCallId: result.callId,
        notMentioned: verified.notMentioned,
      })
      .returning({ id: offerAnalyses.id });
    if (verified.requirements.length > 0) {
      await tx.db.insert(jobRequirements).values(
        verified.requirements.map((r, position) => ({
          userId: job.userId,
          offerId: offer.id,
          analysisId: analysis!.id,
          position,
          kind: r.kind,
          importance: r.importance,
          label: r.label,
          value: r.value,
          minYears: r.minYears,
          provenance: r.provenance,
          quote: r.quote,
          quoteStart: r.quoteStart,
          quoteEnd: r.quoteEnd,
          rationale: r.rationale,
          verificationNote: r.verificationNote,
        })),
      );
    }
    // Les champs déjà renseignés (import structuré ou correction) ne sont jamais écrasés.
    const companyId = offer.companyId ?? (verified.company ? await upsertCompany(tx.db, job.userId, verified.company) : null);
    await tx.db
      .update(jobOffers)
      .set({
        status: "analyzed",
        statusReason: null,
        title: offer.title === provisionalTitle(offer.rawText) && verified.title ? verified.title : offer.title,
        companyId,
        location: offer.location ?? verified.location,
        updatedAt: new Date(),
      })
      .where(eq(jobOffers.id, offer.id));
    return analysis!.id;
  });
  return { kind: "analyzed", analysisId, requirements: verified.requirements.length };
}

export async function getCurrentAnalysis(db: Db, userId: string, offerId: string) {
  const [row] = await db
    .select({ analysis: offerAnalyses, costUsd: llmCalls.costUsd, latencyMs: llmCalls.latencyMs })
    .from(offerAnalyses)
    .leftJoin(llmCalls, eq(llmCalls.id, offerAnalyses.llmCallId))
    .where(and(eq(offerAnalyses.userId, userId), eq(offerAnalyses.offerId, offerId), eq(offerAnalyses.state, "current")))
    .limit(1);
  if (!row) return null;
  const analysis = { ...row.analysis, costUsd: row.costUsd, latencyMs: row.latencyMs };
  const requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.analysisId, analysis.id), eq(jobRequirements.removedByUser, false)))
    .orderBy(asc(jobRequirements.position));
  return { analysis, requirements };
}

export type RequirementPatch = {
  label?: string;
  value?: string | null;
  importance?: "mandatory" | "preferred" | "condition";
  removed?: boolean;
};

/** Correction par l'utilisateur, journalisée avec l'état avant et après. */
export async function correctRequirement(db: Db, userId: string, requirementId: string, patch: RequirementPatch): Promise<boolean> {
  const [current] = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.id, requirementId), eq(jobRequirements.userId, userId)))
    .limit(1);
  if (!current) return false;
  const before = { label: current.label, value: current.value, importance: current.importance, removed: current.removedByUser };
  const after = {
    label: patch.label?.trim() || current.label,
    value: patch.value === undefined ? current.value : patch.value?.trim() || null,
    importance: patch.importance ?? current.importance,
    removed: patch.removed ?? current.removedByUser,
  };
  if (JSON.stringify(before) === JSON.stringify(after)) return true;
  await db.transaction(async (tx) => {
    await tx
      .update(jobRequirements)
      .set({ label: after.label, value: after.value, importance: after.importance, removedByUser: after.removed, correctedByUser: true })
      .where(eq(jobRequirements.id, current.id));
    await tx.insert(requirementCorrections).values({ userId, requirementId: current.id, before, after });
  });
  return true;
}

/** Décision de l'utilisateur sur une offre analysée. */
export async function decideOffer(db: Db, userId: string, offerId: string, decision: "qualify" | "discard"): Promise<boolean> {
  const rows = await db
    .update(jobOffers)
    .set({ status: decision === "qualify" ? "qualified" : "discarded", updatedAt: new Date() })
    .where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId), inArray(jobOffers.status, [...DONE])))
    .returning({ id: jobOffers.id });
  return rows.length === 1;
}

/** Relance manuelle d'une analyse en échec : l'offre repasse en file. */
export async function requeueFailedOffer(db: Db, userId: string, offerId: string): Promise<boolean> {
  const rows = await db
    .update(jobOffers)
    .set({ status: "queued", statusReason: null, updatedAt: new Date() })
    .where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId), eq(jobOffers.status, "failed")))
    .returning({ id: jobOffers.id });
  return rows.length === 1;
}

/** Offres restées en attente ou bloquées en cours d'analyse (budget atteint, worker arrêté) : à remettre en file. */
export async function findStalledOffers(db: Db, olderThan: Date) {
  return db
    .select({ offerId: jobOffers.id, userId: jobOffers.userId })
    .from(jobOffers)
    .where(and(inArray(jobOffers.status, ["queued", "analyzing"]), lt(jobOffers.updatedAt, olderThan)))
    .limit(500);
}
