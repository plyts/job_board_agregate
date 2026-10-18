import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { analyzeOffer, findStalledOffers } from "@/modules/analysis";
import { analysisJobOptions, extractionJobOptions, logger, SCHEDULES } from "@/modules/platform";
import { extractProfile, findStalledExtractions } from "@/modules/profile";
import type { LlmRouter } from "@/modules/platform/llm/router";
import type { LlmClient } from "@/modules/platform/llm/types";

const AnalyzeJob = z.object({ offerId: z.uuid(), userId: z.uuid() });
const ExtractJob = z.object({ versionId: z.uuid(), userId: z.uuid() });

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

  await boss.work("offer.resume", async () => {
    const olderThan = new Date(Date.now() - 15 * 60 * 1000);
    const stalled = await findStalledOffers(deps.db, olderThan);
    for (const s of stalled) await boss.send("offer.analyze", s, analysisJobOptions(s.offerId));
    const extractions = await findStalledExtractions(deps.db, olderThan);
    for (const e of extractions) await boss.send("profile.extract", e, extractionJobOptions(e.versionId));
    if (stalled.length || extractions.length) logger.info({ offers: stalled.length, profiles: extractions.length }, "tâches remises en file");
  });
  for (const { queue, cron } of SCHEDULES) await boss.schedule(queue, cron);
}
