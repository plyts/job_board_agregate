/**
 * Test de charge : N offres importées d'un coup, analysées par le vrai worker (pg-boss, PostgreSQL)
 * avec un modèle simulé (latence réglable, aucun appel réseau, aucun coût).
 * Vérifie : toutes analysées, aucune analyse en double, doublons détectés ; mesure durée et débit.
 *
 * Usage : DATABASE_URL=postgres://…/jobpilot_load npx tsx scripts/load-test.ts --yes [--offers 100] [--latency 800]
 * La base doit contenir « load » dans son nom (elle est modifiée).
 */
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { and, count, countDistinct, eq, sql, sum } from "drizzle-orm";
import { createDb, createPool } from "../src/db/client";
import { runMigrations } from "../src/db/migrate";
import { jobOffers, llmCalls, offerAnalyses, offerImports, users } from "../src/db/schema";
import { createUser, findUserByEmail } from "../src/modules/identity";
import { importOffer } from "../src/modules/offers";
import { analysisJobOptions, createBoss, ensureQueues, transactionDb } from "../src/modules/platform";
import { LocalFsStorage } from "../src/modules/platform/storage";
import type { LlmClient, LlmResult, StructuredRequest } from "../src/modules/platform/llm/types";
import { startWorker } from "../src/worker";
import { EXTRACTION, OFFER_TEXT } from "../tests/helpers/fixtures";

const args = process.argv.slice(2);
const opt = (name: string, fallback: number) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const N = opt("offers", 100);
const LATENCY = opt("latency", 800);
const url = process.env.DATABASE_URL;
if (!url || !args.includes("--yes")) {
  console.error("Usage : DATABASE_URL=…/jobpilot_load npx tsx scripts/load-test.ts --yes [--offers 100] [--latency 800]");
  process.exit(1);
}
if (!new URL(url).pathname.includes("load")) {
  console.error("Refus : la base de test de charge doit contenir « load » dans son nom.");
  process.exit(1);
}

/** Modèle simulé : latence fixe ± 25 %, réponse valide dont les citations figurent dans l'annonce. */
class SimulatedLlm implements LlmClient {
  readonly provider = "local";
  readonly model = "simulation";
  calls = 0;
  estimateCostUsd(): number {
    return 0;
  }
  async generateStructured<T>(req: StructuredRequest<T>): Promise<LlmResult<T>> {
    this.calls++;
    const latency = Math.round(LATENCY * (0.75 + Math.random() * 0.5));
    await new Promise((r) => setTimeout(r, latency));
    const output = req.schema.parse(EXTRACTION);
    return { output, model: this.model, usage: { inputTokens: 1500, outputTokens: 600, cacheReadTokens: 0, cacheWriteTokens: 0 }, latencyMs: latency };
  }
}

const pool = createPool(url);
const db = createDb(pool);
await runMigrations(db);
const boss = createBoss(url, "worker");
boss.on("error", () => {});
await boss.start();
await ensureQueues(boss);

const email = "charge@jobpilot.test";
const previous = await findUserByEmail(db, email);
if (previous) await db.delete(users).where(eq(users.id, previous.id));
const user = await createUser(db, { email, displayName: "Charge", password: "un mot de passe de charge" });
const storage = new LocalFsStorage(await mkdtemp(path.join(tmpdir(), "jobpilot-load-")));
const deps = {
  db,
  pool,
  storage,
  enqueueAnalysis: async (tx: { client: import("pg").PoolClient }, job: { offerId: string; userId: string }) => {
    await boss.send("offer.analyze", job, { ...analysisJobOptions(job.offerId), db: transactionDb(tx.client) });
  },
};

// 1. Import de N offres d'un coup (en parallèle, comme un collage en rafale).
const texts = Array.from({ length: N }, (_, i) => `${OFFER_TEXT}\nRéférence de charge ${i + 1} — ${randomUUID()}.`);
let t0 = Date.now();
const imported = await Promise.all(texts.map((text) => importOffer(deps, user.id, { kind: "text", text })));
const importMs = Date.now() - t0;
const failedImports = imported.filter((r) => !r.ok).length;

// 2. Ré-import de 10 offres : doivent être reconnues comme doublons, sans nouvelle analyse.
const reimported = await Promise.all(texts.slice(0, 10).map((text) => importOffer(deps, user.id, { kind: "text", text })));
const duplicatesDetected = reimported.filter((r) => r.ok && r.duplicate).length;

// 3. Worker réel, modèle simulé.
const llm = new SimulatedLlm();
t0 = Date.now();
await startWorker(boss, { db, pool, llm, budgetUsd: 1000 });
let analyzed = 0;
const timeoutMs = 15 * 60 * 1000;
while (Date.now() - t0 < timeoutMs) {
  const [row] = await db.select({ n: count() }).from(jobOffers).where(and(eq(jobOffers.userId, user.id), eq(jobOffers.status, "analyzed")));
  analyzed = Number(row?.n ?? 0);
  if (analyzed >= N) break;
  await new Promise((r) => setTimeout(r, 500));
}
const analyzeMs = Date.now() - t0;

// 4. Contrôles.
const [analyses] = await db
  .select({ rows: count(), offers: countDistinct(offerAnalyses.offerId) })
  .from(offerAnalyses)
  .where(eq(offerAnalyses.userId, user.id));
const [calls] = await db.select({ n: count(), cost: sum(llmCalls.costUsd) }).from(llmCalls).where(eq(llmCalls.userId, user.id));
const [dups] = await db.select({ n: count() }).from(offerImports).where(and(eq(offerImports.userId, user.id), eq(offerImports.outcome, "duplicate")));
const latencies = await db.execute<{ p50: number; p95: number }>(
  sql`select percentile_cont(0.5) within group (order by latency_ms) p50, percentile_cont(0.95) within group (order by latency_ms) p95 from llm_calls where user_id = ${user.id}`,
);

const report = {
  offers: N,
  simulatedLatencyMs: LATENCY,
  importMs,
  failedImports,
  duplicatesDetected: `${duplicatesDetected}/10 (journal : ${dups?.n})`,
  analyzed,
  analyzeMs,
  throughputPerMinute: Math.round((analyzed / (analyzeMs / 1000)) * 60 * 10) / 10,
  analysesRows: Number(analyses?.rows),
  offersWithAnalysis: Number(analyses?.offers),
  noDuplicateAnalysis: Number(analyses?.rows) === Number(analyses?.offers),
  modelCalls: llm.calls,
  journaledCalls: Number(calls?.n),
  costUsd: Number(calls?.cost ?? 0),
  modelLatencyP50Ms: Math.round(Number(latencies.rows[0]?.p50 ?? 0)),
  modelLatencyP95Ms: Math.round(Number(latencies.rows[0]?.p95 ?? 0)),
};
console.log(JSON.stringify(report, null, 2));

await boss.stop({ graceful: true, timeout: 10_000 });
await pool.end();
const ok = analyzed === N && report.noDuplicateAnalysis && duplicatesDetected === 10 && failedImports === 0;
process.exit(ok ? 0 : 2);
