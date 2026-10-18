import { and, asc, desc, eq, inArray, isNull, lt } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { cvVersions, jobOffers, jobRequirements, matchAnalyses, matchItems, offerAnalyses, profileVersions, type MatchEvidence } from "@/db/schema";
import { cvAsProfile } from "@/modules/cv/content";
import { withTransaction, type TxContext } from "@/db/transaction";
import { generateJournaled } from "@/modules/platform/llm/journal";
import type { LlmRouter } from "@/modules/platform/llm/router";
import { LlmError, type LlmClient } from "@/modules/platform/llm/types";
import { evidenceElements, type ProfileContent } from "@/modules/profile/content";
import { getCurrentProfile } from "@/modules/profile";
import { buildMatchUserMessage, guardJudgement, MATCH_PROMPT_VERSION, MATCH_SCHEMA_VERSION, MATCH_SYSTEM, MatchJudgement, type RequirementInput } from "./judge";
import { exclusionHit, yearsRule } from "./rules";
import { computeScore, DEFAULT_WEIGHTS, FACTORS, type MatchCategory, type Weights } from "./score";

export type MatchRequestDeps = {
  db: Db;
  pool: Pool;
  enqueueMatch: (tx: TxContext, job: { matchId: string; userId: string }) => Promise<void>;
};

export type RequestMatchResult = { ok: true; matchId: string } | { ok: false; code: "NO_OFFER" | "NO_ANALYSIS" | "NO_PROFILE"; message: string };

/** Demande un matching de l'offre avec le profil maître courant ; le calcul se fait dans le worker. */
export async function requestMatch(deps: MatchRequestDeps, userId: string, offerId: string, weights: Weights = DEFAULT_WEIGHTS): Promise<RequestMatchResult> {
  const { db } = deps;
  const [offer] = await db.select({ id: jobOffers.id }).from(jobOffers).where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId))).limit(1);
  if (!offer) return { ok: false, code: "NO_OFFER", message: "Offre introuvable." };
  const [analysis] = await db
    .select({ id: offerAnalyses.id })
    .from(offerAnalyses)
    .where(and(eq(offerAnalyses.offerId, offerId), eq(offerAnalyses.state, "current")))
    .limit(1);
  if (!analysis) return { ok: false, code: "NO_ANALYSIS", message: "L'offre doit d'abord être analysée." };
  const profile = await getCurrentProfile(db, userId);
  if (!profile) return { ok: false, code: "NO_PROFILE", message: "Valide d'abord ton profil maître." };

  const matchId = await withTransaction(deps.pool, async (tx) => {
    await tx.db
      .update(matchAnalyses)
      .set({ state: "superseded" })
      .where(and(eq(matchAnalyses.offerId, offerId), eq(matchAnalyses.state, "current"), eq(matchAnalyses.userId, userId), isNull(matchAnalyses.cvVersionId)));
    const [row] = await tx.db
      .insert(matchAnalyses)
      .values({ userId, offerId, offerAnalysisId: analysis.id, profileVersionId: profile.id, weights })
      .returning({ id: matchAnalyses.id });
    await deps.enqueueMatch(tx, { matchId: row!.id, userId });
    return row!.id;
  });
  return { ok: true, matchId };
}

export type MatchComputeDeps = { db: Db; pool: Pool; llm: LlmClient | LlmRouter | null; budgetUsd?: number; today?: Date };

export type MatchOutcome =
  | { kind: "done"; score: number | null; mode: "model" | "rules_only" }
  | { kind: "skipped" }
  | { kind: "deferred"; reason: string }
  | { kind: "failed"; reason: string };

type Composed = { requirementId: string; category: MatchCategory; evidenceIds: string[]; rationale: string; action: string; source: "rule" | "model" | "guard" };

const RULES_ONLY_NOTE = "Évaluation détaillée indisponible : aucun fournisseur IA n'est autorisé à recevoir ton profil.";

/**
 * Calcule un matching : règles déterministes (années, exclusions) puis jugement du modèle pour le reste,
 * corrigé par des garde-fous. Sans fournisseur autorisé, seul le calcul par règles est fait, et signalé.
 */
export async function computeMatch(
  deps: MatchComputeDeps,
  job: { matchId: string; userId: string },
  attempt: { isFinal: boolean } = { isFinal: false },
): Promise<MatchOutcome> {
  const { db } = deps;
  const [match] = await db
    .select()
    .from(matchAnalyses)
    .where(and(eq(matchAnalyses.id, job.matchId), eq(matchAnalyses.userId, job.userId)))
    .limit(1);
  if (!match || match.status === "done") return { kind: "skipped" };
  const [profile] = await db.select().from(profileVersions).where(eq(profileVersions.id, match.profileVersionId)).limit(1);
  let content: ProfileContent | undefined = profile?.content;
  if (!content) return { kind: "skipped" };
  if (match.cvVersionId) {
    // Recontrôle : on compare l'offre à ce que le CV personnalisé montre réellement.
    const [cv] = await db.select({ content: cvVersions.content }).from(cvVersions).where(eq(cvVersions.id, match.cvVersionId)).limit(1);
    if (!cv) return { kind: "skipped" };
    content = cvAsProfile(cv.content, content);
  }
  const subject = content;
  const requirements = await db
    .select()
    .from(jobRequirements)
    .where(and(eq(jobRequirements.analysisId, match.offerAnalysisId), eq(jobRequirements.removedByUser, false)))
    .orderBy(asc(jobRequirements.position));

  const composed = new Map<string, Composed>();
  const toJudge: RequirementInput[] = [];
  requirements.forEach((r, i) => {
    const excluded = exclusionHit(r, subject.preferences.exclusions);
    if (excluded) {
      composed.set(r.id, {
        requirementId: r.id,
        category: "potential_incompatibility",
        evidenceIds: [],
        rationale: `Correspond à ton critère d'exclusion « ${excluded} ».`,
        action: "Décider si ce critère est rédhibitoire pour cette offre.",
        source: "rule",
      });
    } else if (r.kind === "years" && r.minYears !== null) {
      composed.set(r.id, { requirementId: r.id, ...yearsRule(r.minYears, subject, deps.today), source: "rule" });
    } else {
      toJudge.push({ ref: `R${i + 1}`, kind: r.kind, importance: r.importance, label: r.label, value: r.value });
    }
  });
  const refToId = new Map(requirements.map((r, i) => [`R${i + 1}`, r.id]));

  let mode: "model" | "rules_only" = "model";
  let llmCallId: string | null = null;
  if (toJudge.length > 0) {
    let judged: MatchJudgement | null = null;
    if (deps.llm) {
      try {
        const result = await generateJournaled(
          db,
          deps.llm,
          job.userId,
          {
            purpose: "match.judge",
            promptVersion: MATCH_PROMPT_VERSION,
            schemaVersion: MATCH_SCHEMA_VERSION,
            dataClass: "personal",
            system: MATCH_SYSTEM,
            user: buildMatchUserMessage(toJudge, subject),
            schema: MatchJudgement,
            maxTokens: 16000,
            effort: "medium",
          },
          { budgetUsd: deps.budgetUsd },
        );
        judged = result.output;
        llmCallId = result.callId;
      } catch (err) {
        if (!(err instanceof LlmError)) throw err;
        if (err.code === "budget_exceeded" || err.code === "quota_exhausted") {
          const reason = "Budget ou quotas IA du jour atteints : le matching reprendra automatiquement.";
          await db.update(matchAnalyses).set({ statusReason: reason }).where(eq(matchAnalyses.id, match.id));
          return { kind: "deferred", reason };
        }
        if (err.code !== "no_provider") {
          if (err.retryable && !attempt.isFinal) {
            await db.update(matchAnalyses).set({ statusReason: `Échec temporaire (${err.message}) : nouvel essai automatique.` }).where(eq(matchAnalyses.id, match.id));
            throw err;
          }
          const reason = `Matching impossible : ${err.message}.`;
          await db.update(matchAnalyses).set({ status: "failed", statusReason: reason }).where(eq(matchAnalyses.id, match.id));
          return { kind: "failed", reason };
        }
      }
    }
    if (judged) {
      for (const raw of judged.items) {
        const requirementId = refToId.get(raw.requirementRef);
        if (!requirementId || composed.has(requirementId)) continue;
        composed.set(requirementId, { requirementId, ...guardJudgement(raw, subject) });
      }
    } else {
      mode = "rules_only";
    }
    for (const r of toJudge) {
      const requirementId = refToId.get(r.ref)!;
      if (composed.has(requirementId)) continue;
      composed.set(requirementId, {
        requirementId,
        category: "to_confirm",
        evidenceIds: [],
        rationale: mode === "rules_only" ? RULES_ONLY_NOTE : "Exigence non évaluée par le modèle.",
        action: "Vérifier toi-même cette exigence.",
        source: mode === "rules_only" ? "rule" : "guard",
      });
    }
  }

  const elements = new Map(evidenceElements(subject).map((e) => [e.id, e]));
  const ordered = requirements.map((r) => ({ requirement: r, item: composed.get(r.id)! }));
  const { score, factors } = computeScore(
    ordered.map(({ requirement, item }) => ({ kind: requirement.kind, importance: requirement.importance, category: item.category })),
    match.weights,
  );
  await withTransaction(deps.pool, async (tx) => {
    await tx.db.delete(matchItems).where(eq(matchItems.matchId, match.id));
    if (ordered.length) {
      await tx.db.insert(matchItems).values(
        ordered.map(({ item, requirement }, position) => ({
          matchId: match.id,
          requirementId: item.requirementId,
          position,
          kind: requirement.kind,
          importance: requirement.importance,
          category: item.category,
          evidence: item.evidenceIds
            .map((id) => elements.get(id))
            .filter((e): e is NonNullable<typeof e> => Boolean(e))
            .map((e): MatchEvidence => ({ id: e.id, label: e.label, text: e.text })),
          rationale: item.rationale,
          action: item.action,
          source: item.source,
        })),
      );
    }
    await tx.db
      .update(matchAnalyses)
      .set({ status: "done", statusReason: null, mode, score, factors, llmCallId, completedAt: new Date() })
      .where(eq(matchAnalyses.id, match.id));
  });
  return { kind: "done", score, mode };
}

async function withItems(db: Db, match: typeof matchAnalyses.$inferSelect) {
  const items = await db
    .select({ item: matchItems, requirement: jobRequirements })
    .from(matchItems)
    .innerJoin(jobRequirements, eq(jobRequirements.id, matchItems.requirementId))
    .where(eq(matchItems.matchId, match.id))
    .orderBy(asc(matchItems.position));
  const [profile] = await db
    .select({ version: profileVersions.version })
    .from(profileVersions)
    .where(eq(profileVersions.id, match.profileVersionId))
    .limit(1);
  return { match, items, profileVersion: profile?.version ?? null };
}

export type MatchView = Awaited<ReturnType<typeof withItems>>;

/** Matching courant de l'offre avec le profil maître (hors recontrôles de CV). */
export async function getCurrentMatch(db: Db, userId: string, offerId: string): Promise<MatchView | null> {
  const [match] = await db
    .select()
    .from(matchAnalyses)
    .where(and(eq(matchAnalyses.userId, userId), eq(matchAnalyses.offerId, offerId), eq(matchAnalyses.state, "current"), isNull(matchAnalyses.cvVersionId)))
    .orderBy(desc(matchAnalyses.createdAt))
    .limit(1);
  return match ? withItems(db, match) : null;
}

/** Dernier recontrôle d'une version de CV. */
export async function getCvCheck(db: Db, userId: string, cvVersionId: string): Promise<MatchView | null> {
  const [match] = await db
    .select()
    .from(matchAnalyses)
    .where(and(eq(matchAnalyses.userId, userId), eq(matchAnalyses.cvVersionId, cvVersionId), eq(matchAnalyses.state, "current")))
    .orderBy(desc(matchAnalyses.createdAt))
    .limit(1);
  return match ? withItems(db, match) : null;
}

export type RequestCvCheckResult = { ok: true; matchId: string } | { ok: false; code: "NO_VERSION" | "NO_ANALYSIS"; message: string };

/**
 * Recontrôle d'une version enregistrée du CV : nouveau matching sur le contenu du CV, avec les poids
 * du matching de référence pour que les deux scores soient comparables. Idempotent tant que l'analyse
 * de l'offre ne change pas.
 */
export async function requestCvCheck(deps: MatchRequestDeps, userId: string, cvVersionId: string): Promise<RequestCvCheckResult> {
  const { db } = deps;
  const [cv] = await db
    .select()
    .from(cvVersions)
    .where(and(eq(cvVersions.id, cvVersionId), eq(cvVersions.userId, userId), inArray(cvVersions.status, ["saved", "finalized"])))
    .limit(1);
  if (!cv) return { ok: false, code: "NO_VERSION", message: "Version de CV introuvable ou non enregistrée." };
  const [analysis] = await db
    .select({ id: offerAnalyses.id })
    .from(offerAnalyses)
    .where(and(eq(offerAnalyses.offerId, cv.offerId), eq(offerAnalyses.state, "current")))
    .limit(1);
  if (!analysis) return { ok: false, code: "NO_ANALYSIS", message: "L'offre n'a plus d'analyse courante." };
  const existing = await getCvCheck(db, userId, cv.id);
  if (existing && existing.match.offerAnalysisId === analysis.id && existing.match.status !== "failed") return { ok: true, matchId: existing.match.id };
  const reference = await getCurrentMatch(db, userId, cv.offerId);

  const matchId = await withTransaction(deps.pool, async (tx) => {
    await tx.db
      .update(matchAnalyses)
      .set({ state: "superseded" })
      .where(and(eq(matchAnalyses.cvVersionId, cv.id), eq(matchAnalyses.state, "current"), eq(matchAnalyses.userId, userId)));
    const [row] = await tx.db
      .insert(matchAnalyses)
      .values({
        userId,
        offerId: cv.offerId,
        offerAnalysisId: analysis.id,
        profileVersionId: cv.baseProfileVersionId,
        cvVersionId: cv.id,
        weights: reference?.match.weights ?? DEFAULT_WEIGHTS,
      })
      .returning({ id: matchAnalyses.id });
    await deps.enqueueMatch(tx, { matchId: row!.id, userId });
    return row!.id;
  });
  return { ok: true, matchId };
}

export function parseWeights(input: Record<string, unknown>): Weights | null {
  const out = {} as Weights;
  for (const f of FACTORS) {
    const n = Number(input[f]);
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    out[f] = Math.round(n);
  }
  return Object.values(out).some((v) => v > 0) ? out : null;
}

/** Changer les poids recalcule le score à partir des catégories enregistrées, sans nouvel appel au modèle. */
export async function updateWeights(db: Db, userId: string, matchId: string, weights: Weights): Promise<number | null | undefined> {
  const [match] = await db
    .select()
    .from(matchAnalyses)
    .where(and(eq(matchAnalyses.id, matchId), eq(matchAnalyses.userId, userId), eq(matchAnalyses.status, "done")))
    .limit(1);
  if (!match) return undefined;
  const rows = await db
    .select({ category: matchItems.category, kind: matchItems.kind, importance: matchItems.importance })
    .from(matchItems)
    .where(eq(matchItems.matchId, match.id));
  const { score, factors } = computeScore(rows, weights);
  await db.update(matchAnalyses).set({ weights, score, factors }).where(eq(matchAnalyses.id, match.id));
  return score;
}

export async function findStalledMatches(db: Db, olderThan: Date) {
  return db
    .select({ matchId: matchAnalyses.id, userId: matchAnalyses.userId })
    .from(matchAnalyses)
    .where(and(inArray(matchAnalyses.status, ["pending"]), eq(matchAnalyses.state, "current"), lt(matchAnalyses.createdAt, olderThan)))
    .limit(100);
}
