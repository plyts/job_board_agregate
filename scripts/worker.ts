/**
 * Processus de traitement en arrière-plan : analyses IA, exports, tâches planifiées.
 * Usage : DATABASE_URL=… npm run worker
 */
import { createBoss, ensureQueues, logger } from "../src/modules/platform";
import { handlers } from "../src/worker/registry";

const url = process.env.DATABASE_URL;
if (!url) {
  logger.fatal("DATABASE_URL n'est pas définie");
  process.exit(1);
}

const boss = createBoss(url, "worker");
boss.on("error", (err) => logger.error({ err }, "pg-boss"));
await boss.start();
await ensureQueues(boss);

for (const [name, handler] of Object.entries(handlers)) {
  if (!handler) continue;
  await boss.work<Record<string, unknown>>(name, { batchSize: 1 }, async (jobs) => {
    const started = Date.now();
    try {
      await handler(jobs);
      logger.info({ queue: name, jobIds: jobs.map((j) => j.id), ms: Date.now() - started }, "tâche terminée");
    } catch (err) {
      logger.warn({ queue: name, jobIds: jobs.map((j) => j.id), err }, "tâche en échec");
      throw err; // pg-boss planifie le prochain essai selon la politique de la file
    }
  });
  logger.info({ queue: name }, "file écoutée");
}

async function shutdown(signal: string) {
  logger.info({ signal }, "arrêt du worker");
  await boss.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
logger.info("worker démarré");
