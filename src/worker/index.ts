import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { analyzeOffer, findStalledOffers } from "@/modules/analysis";
import { findStalledSuggestions, generateSuggestions } from "@/modules/cv";
import { computeMatch, findStalledMatches } from "@/modules/matching";
import { analysisJobOptions, extractionJobOptions, logger, matchJobOptions, SCHEDULES, suggestJobOptions } from "@/modules/platform";
import { extractProfile, findStalledExtractions } from "@/modules/profile";
import type { LlmRouter } from "@/modules/platform/llm/router";
import type { LlmClient } from "@/modules/platform/llm/types";

const AnalyzeJob = z.object({ offerId: z.uuid(), userId: z.uuid() });
const ExtractJob = z.object({ versionId: z.uuid(), userId: z.uuid() });
const MatchJob = z.object({ matchId: z.uuid(), userId: z.uuid() });
const SuggestJob = z.object({ draftId: z.uuid(), userId: z.uuid() });

export type WorkerDeps = { db: Db; pool: Pool; llm: LlmClient | LlmRouter | null; budgetUsd?: number };

/** Branche les traitements sur les files. Sans client IA, les analyses restent en file (aucun échec artificiel). */
export async function startWorker(boss: PgBoss, deps: WorkerDeps): Promise<void> {
  if (deps.llm) {
    const llm = deps.llm;
    await boss.work("offer.analyze", { batchSize: 1, includeMetadata: true }, async ([job]) => {
      if (!job) return;
      const data = AnalyzeJob.safeParse(job.data);
      if (!data.success) {
        logger.error({ jobId: job.id }, "tâche offer.analyze invalide ignorée");
        return;
      }
      const started = Date.now();
      const outcome = await analyzeOffer({ db: deps.db, pool: deps.pool, llm, budgetUsd: deps.budgetUsd }, data.data, {
        isFinal: job.retryCount >= job.retryLimit,
      });
      logger.info({ jobId: job.id, offerId: data.data.offerId, outcome: outcome.kind, ms: Date.now() - started }, "analyse d'offre");
    });
    await boss.work("profile.extract", { batchSize: 1, includeMetadata: true }, async ([job]) => {
      if (!job) return;
      const data = ExtractJob.safeParse(job.data);
      if (!data.success) {
        logger.error({ jobId: job.id }, "tâche profile.extract invalide ignorée");
        return;
      }
      const outcome = await extractProfile({ db: deps.db, llm, budgetUsd: deps.budgetUsd }, data.data, { isFinal: job.retryCount >= job.retryLimit });
      logger.info({ jobId: job.id, outcome: outcome.kind }, "extraction de CV");
    });
  } else {
    logger.warn("Aucun fournisseur IA configuré : les analyses d'offres et extractions de CV restent en file.");
  }

  // Le matching fonctionne aussi sans fournisseur IA, en mode « règles seules » clairement signalé.
  await boss.work("match.compute", { batchSize: 1, includeMetadata: true }, async ([job]) => {
    if (!job) return;
    const data = MatchJob.safeParse(job.data);
    if (!data.success) {
      logger.error({ jobId: job.id }, "tâche match.compute invalide ignorée");
      return;
    }
    const outcome = await computeMatch({ db: deps.db, pool: deps.pool, llm: deps.llm, budgetUsd: deps.budgetUsd }, data.data, {
      isFinal: job.retryCount >= job.retryLimit,
    });
    logger.info({ jobId: job.id, outcome: outcome.kind }, "matching");
  });

  // Sans fournisseur, la demande échoue avec un message clair : l'éditeur reste utilisable à la main.
  await boss.work("cv.suggest", { batchSize: 1, includeMetadata: true }, async ([job]) => {
    if (!job) return;
    const data = SuggestJob.safeParse(job.data);
    if (!data.success) {
      logger.error({ jobId: job.id }, "tâche cv.suggest invalide ignorée");
      return;
    }
    const outcome = await generateSuggestions({ db: deps.db, llm: deps.llm, budgetUsd: deps.budgetUsd }, data.data, {
      isFinal: job.retryCount >= job.retryLimit,
    });
    logger.info({ jobId: job.id, outcome: outcome.kind }, "suggestions de CV");
  });

  await boss.work("offer.resume", async () => {
    const olderThan = new Date(Date.now() - 15 * 60 * 1000);
    const stalled = await findStalledOffers(deps.db, olderThan);
    for (const s of stalled) await boss.send("offer.analyze", s, analysisJobOptions(s.offerId));
    const extractions = await findStalledExtractions(deps.db, olderThan);
    for (const e of extractions) await boss.send("profile.extract", e, extractionJobOptions(e.versionId));
    const matches = await findStalledMatches(deps.db, olderThan);
    for (const m of matches) await boss.send("match.compute", m, matchJobOptions(m.matchId));
    const suggestions = await findStalledSuggestions(deps.db, olderThan);
    for (const s of suggestions) await boss.send("cv.suggest", s, suggestJobOptions(s.draftId));
    if (stalled.length || extractions.length || matches.length || suggestions.length) {
      logger.info({ offers: stalled.length, profiles: extractions.length, matches: matches.length, suggestions: suggestions.length }, "tâches remises en file");
    }
  });
  for (const { queue, cron } of SCHEDULES) await boss.schedule(queue, cron);
}
