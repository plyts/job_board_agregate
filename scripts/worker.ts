/**
 * Processus de traitement en arrière-plan : analyses IA et tâches planifiées.
 * Usage : DATABASE_URL=… [GROQ_API_KEY=… GROQ_MODEL=…] npm run worker (voir .env.example)
 */
import { getDb, getPool } from "../src/db/client";
import { createBoss, createRouterFromEnv, dailyBudgetUsd, ensureQueues, getStorage, logger, providerStatuses } from "../src/modules/platform";
import { startWorker } from "../src/worker";

const url = process.env.DATABASE_URL;
if (!url) {
  logger.fatal("DATABASE_URL n'est pas définie");
  process.exit(1);
}

const boss = createBoss(url, "worker");
boss.on("error", (err) => logger.error({ err }, "pg-boss"));
await boss.start();
await ensureQueues(boss);

const llm = createRouterFromEnv();
await startWorker(boss, { db: getDb(), pool: getPool(), llm, budgetUsd: dailyBudgetUsd(), storage: getStorage() });

async function shutdown(signal: string) {
  logger.info({ signal }, "arrêt du worker");
  await boss.stop({ graceful: true, timeout: 30_000 });
  await getPool().end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
logger.info(
  { providers: providerStatuses().map((p) => ({ id: p.id, enabled: p.enabled, model: p.model, personalData: p.policy.allowsPersonalData })) },
  "worker démarré",
);
