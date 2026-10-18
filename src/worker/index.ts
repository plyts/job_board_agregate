import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { analyzeOffer, findStalledOffers } from "@/modules/analysis";
import { analysisJobOptions, logger, SCHEDULES } from "@/modules/platform";
import type { LlmRouter } from "@/modules/platform/llm/router";
import type { LlmClient } from "@/modules/platform/llm/types";

const AnalyzeJob = z.object({ offerId: z.uuid(), userId: z.uuid() });

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
  } else {
    logger.warn("Aucun fournisseur IA configuré : les analyses d'offres restent en file.");
  }

  await boss.work("offer.resume", async () => {
    const stalled = await findStalledOffers(deps.db, new Date(Date.now() - 15 * 60 * 1000));
    for (const s of stalled) await boss.send("offer.analyze", s, analysisJobOptions(s.offerId));
    if (stalled.length) logger.info({ count: stalled.length }, "analyses remises en file");
  });
  for (const { queue, cron } of SCHEDULES) await boss.schedule(queue, cron);
}
