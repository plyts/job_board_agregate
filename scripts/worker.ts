/**
 * Processus de traitement en arrière-plan : analyses IA et tâches planifiées.
 * Usage : DATABASE_URL=… [ANTHROPIC_API_KEY=…] npm run worker
 */
import { getDb, getPool } from "../src/db/client";
import { AnthropicLlmClient, createBoss, dailyBudgetUsd, ensureQueues, logger } from "../src/modules/platform";
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

const llm = process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN ? new AnthropicLlmClient() : null;
await startWorker(boss, { db: getDb(), pool: getPool(), llm, budgetUsd: dailyBudgetUsd() });

async function shutdown(signal: string) {
  logger.info({ signal }, "arrêt du worker");
  await boss.stop({ graceful: true, timeout: 30_000 });
  await getPool().end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
logger.info({ model: llm?.model ?? null }, "worker démarré");
