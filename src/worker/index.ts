import type { PgBoss } from "pg-boss";
import type { Pool } from "pg";
import { z } from "zod";
import type { Db } from "@/db/client";
import { analyzeOffer, findStalledOffers } from "@/modules/analysis";
import { draftLetter, findStalledLetters } from "@/modules/applications";
import { findStalledSuggestions, generateSuggestions } from "@/modules/cv";
import { deleteExpiredSessions, purgeLoginAttempts } from "@/modules/identity";
import { computeMatch, findStalledMatches } from "@/modules/matching";
import {
  analysisJobOptions,
  BACKUP_JOB_OPTIONS,
  backupConfig,
  closeInterruptedBackups,
  extractionJobOptions,
  letterJobOptions,
  logger,
  matchJobOptions,
  runBackup,
  SCHEDULES,
  suggestJobOptions,
  type BackupExec,
} from "@/modules/platform";
import { backupRuns } from "@/db/schema";
import { extractProfile, findStalledExtractions, purgeImportedSources, sourceRetentionDays } from "@/modules/profile";
import type { LlmRouter } from "@/modules/platform/llm/router";
import type { LlmClient } from "@/modules/platform/llm/types";
import type { ObjectStorage } from "@/modules/platform/storage";

const AnalyzeJob = z.object({ offerId: z.uuid(), userId: z.uuid() });
const ExtractJob = z.object({ versionId: z.uuid(), userId: z.uuid() });
const MatchJob = z.object({ matchId: z.uuid(), userId: z.uuid() });
const SuggestJob = z.object({ draftId: z.uuid(), userId: z.uuid() });
const LetterJob = z.object({ applicationId: z.uuid(), userId: z.uuid() });
const BackupJob = z.object({ trigger: z.enum(["schedule", "manual"]) });

export type WorkerDeps = {
  db: Db;
  pool: Pool;
  llm: LlmClient | LlmRouter | null;
  budgetUsd?: number;
  storage?: ObjectStorage;
  /** Exécution de la sauvegarde ; absente si BACKUP_DIR ou BACKUP_PASSPHRASE manque. */
  backup?: BackupExec;
};

/**
 * Cadence des files : relève toutes les 0,5 s (2 s par défaut chez pg-boss, qui limitait le débit à environ
 * 30 analyses par minute) et 2 tâches en parallèle par file. Les limites des fournisseurs restent appliquées
 * par le routeur ; le budget journalier peut être dépassé d'au plus un appel par tâche en parallèle.
 */
export function workerPace(env: Record<string, string | undefined> = process.env) {
  const poll = Number(env.WORKER_POLL_SECONDS ?? 0.5);
  const concurrency = Number(env.WORKER_CONCURRENCY ?? 2);
  return {
    pollingIntervalSeconds: Number.isFinite(poll) && poll >= 0.5 ? poll : 0.5,
    localConcurrency: Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 16 ? concurrency : 2,
  };
}

/** Branche les traitements sur les files. Sans client IA, les analyses restent en file (aucun échec artificiel). */
export async function startWorker(boss: PgBoss, deps: WorkerDeps): Promise<void> {
  const pace = workerPace();
  if (deps.llm) {
    const llm = deps.llm;
    await boss.work("offer.analyze", { batchSize: 1, includeMetadata: true, ...pace }, async ([job]) => {
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
    await boss.work("profile.extract", { batchSize: 1, includeMetadata: true, ...pace }, async ([job]) => {
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
  await boss.work("match.compute", { batchSize: 1, includeMetadata: true, ...pace }, async ([job]) => {
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
  await boss.work("cv.suggest", { batchSize: 1, includeMetadata: true, ...pace }, async ([job]) => {
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

  // Lettre proposée par l'IA : sans fournisseur, la demande échoue avec un message clair ; la lettre se rédige à la main.
  await boss.work("letter.draft", { batchSize: 1, includeMetadata: true, ...pace }, async ([job]) => {
    if (!job) return;
    const data = LetterJob.safeParse(job.data);
    if (!data.success) {
      logger.error({ jobId: job.id }, "tâche letter.draft invalide ignorée");
      return;
    }
    const outcome = await draftLetter({ db: deps.db, llm: deps.llm, budgetUsd: deps.budgetUsd }, data.data, {
      isFinal: job.retryCount >= job.retryLimit,
    });
    logger.info({ jobId: job.id, outcome: outcome.kind }, "proposition de lettre");
  });

  // Sauvegarde chiffrée : chaque exécution est journalisée (backup_runs), sans secret.
  await boss.work("backup.run", { batchSize: 1, includeMetadata: true, ...pace }, async ([job]) => {
    if (!job) return;
    const trigger = BackupJob.safeParse(job.data).data?.trigger ?? "manual";
    if (!deps.backup) {
      const config = backupConfig();
      const error = config.enabled ? "Sauvegardes non activées dans ce worker." : `Sauvegardes non configurées : manque ${config.missing.join(", ")}.`;
      await deps.db.insert(backupRuns).values({ trigger, status: "failed", finishedAt: new Date(), error });
      return;
    }
    const run = await runBackup(deps.db, deps.backup, trigger);
    if (run.status === "ok") logger.info({ file: run.fileName, bytes: run.sizeBytes }, "sauvegarde terminée");
    else logger.error({ error: run.error }, "sauvegarde en échec");
  });

  await boss.work("offer.resume", async () => {
    const olderThan = new Date(Date.now() - 15 * 60 * 1000);
    const stalled = await findStalledOffers(deps.db, olderThan);
    for (const s of stalled) await boss.send("offer.analyze", s, analysisJobOptions(s.offerId));
    const extractions = await findStalledExtractions(deps.db, olderThan);
    for (const e of extractions) await boss.send("profile.extract", e, extractionJobOptions(e.versionId));
    const matches = await findStalledMatches(deps.db, olderThan);
    for (const m of matches) await boss.send("match.compute", m, matchJobOptions(m.matchId));
    // Conservation limitée (RGPD) : sessions expirées, tentatives de connexion, CV importé après validation.
    await deleteExpiredSessions(deps.db);
    await closeInterruptedBackups(deps.db);
    await purgeLoginAttempts(deps.db);
    if (deps.storage) {
      const purged = await purgeImportedSources({ db: deps.db, storage: deps.storage }, sourceRetentionDays());
      if (purged) logger.info({ purged }, "CV sources effacés après la durée de conservation");
    }
    const suggestions = await findStalledSuggestions(deps.db, olderThan);
    for (const s of suggestions) await boss.send("cv.suggest", s, suggestJobOptions(s.draftId));
    const letters = await findStalledLetters(deps.db, olderThan);
    for (const l of letters) await boss.send("letter.draft", l, letterJobOptions(l.applicationId));
    if (stalled.length || extractions.length || matches.length || suggestions.length || letters.length) {
      logger.info(
        { offers: stalled.length, profiles: extractions.length, matches: matches.length, suggestions: suggestions.length, letters: letters.length },
        "tâches remises en file",
      );
    }
  });
  for (const { queue, cron } of SCHEDULES) await boss.schedule(queue, cron);
  // Sauvegarde quotidienne (fuseau de l'application) ; une échéance manquée pendant un arrêt est rattrapée une fois.
  const backup = backupConfig();
  if (deps.backup && backup.enabled) {
    // La configuration voyage avec la planification : le serveur web l'affiche sans avoir accès aux variables du worker.
    const data = { trigger: "schedule", offsite: backup.offsite, retentionDays: backup.retentionDays };
    await boss.schedule("backup.run", backup.cron, data, { ...BACKUP_JOB_OPTIONS, tz: backup.timeZone, missed: "once" });
    logger.info({ cron: backup.cron, tz: backup.timeZone, offsite: backup.offsite }, "sauvegardes planifiées");
  } else {
    await boss.unschedule("backup.run");
    logger.warn("Sauvegardes non planifiées : renseigne BACKUP_DIR et BACKUP_PASSPHRASE.");
  }
}
