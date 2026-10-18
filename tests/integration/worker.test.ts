import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createPool } from "@/db/client";
import { createUser } from "@/modules/identity";
import { getOffer, importOffer } from "@/modules/offers";
import { analysisJobOptions, createBoss, ensureQueues, transactionDb } from "@/modules/platform/queue";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LocalFsStorage } from "@/modules/platform/storage";
import { startWorker } from "@/worker";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";
import { EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";

describe("worker", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const boss = createBoss(TEST_DATABASE_URL, "worker");

  beforeAll(async () => {
    await resetDb(db);
    await boss.start();
    for (const q of ["offer.analyze", "offer.resume"]) await boss.deleteQueue(q).catch(() => {});
    await ensureQueues(boss);
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await pool.end();
    await closeTestDb();
  });

  it("analyse une offre importée de bout en bout", async () => {
    const llm = new FakeLlmClient().respondWith(EXTRACTION);
    await startWorker(boss, { db: createDb(pool), pool, llm });
    const userId = (await createUser(db, { email: "w@exemple.fr", displayName: "W", password: "un mot de passe solide" })).id;
    const result = await importOffer(
      {
        db,
        pool,
        storage: new LocalFsStorage("/tmp/jobpilot-worker-unused"),
        enqueueAnalysis: async (tx, job) => {
          await boss.send("offer.analyze", job, { ...analysisJobOptions(job.offerId), db: transactionDb(tx.client) });
        },
      },
      userId,
      { kind: "text", text: OFFER_TEXT },
    );
    if (!result.ok) throw new Error("import attendu");

    const deadline = Date.now() + 15_000;
    let status = "";
    while (Date.now() < deadline) {
      status = (await getOffer(db, userId, result.offerId))?.status ?? "";
      if (status === "analyzed") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(status).toBe("analyzed");
    expect(llm.requests).toHaveLength(1);
  }, 20_000);
});
