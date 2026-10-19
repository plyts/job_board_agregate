import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createPool } from "@/db/client";
import { matchAnalyses } from "@/db/schema";
import type { TxContext } from "@/db/transaction";
import { createUser } from "@/modules/identity";
import { getOffer, importOffer } from "@/modules/offers";
import { analysisJobOptions, createBoss, ensureQueues, transactionDb } from "@/modules/platform/queue";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmError } from "@/modules/platform/llm/types";
import { LocalFsStorage } from "@/modules/platform/storage";
import { saveDraft, startDraft, validateDraft } from "@/modules/profile";
import { toProfileContent } from "@/modules/profile/extract";
import { startWorker } from "@/worker";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";

describe("worker", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const boss = createBoss(TEST_DATABASE_URL, "worker");

  beforeAll(async () => {
    await resetDb(db);
    await boss.start();
    for (const q of ["offer.analyze", "offer.resume", "match.compute"]) await boss.deleteQueue(q).catch(() => {});
    await ensureQueues(boss);
  });
  afterAll(async () => {
    await boss.stop({ graceful: false });
    await pool.end();
    await closeTestDb();
  });

  const llm = new FakeLlmClient();
  const offerDeps = {
    db,
    pool,
    storage: new LocalFsStorage("/tmp/jobpilot-worker-unused"),
    enqueueAnalysis: async (tx: TxContext, job: { offerId: string; userId: string }) => {
      await boss.send("offer.analyze", job, { ...analysisJobOptions(job.offerId), db: transactionDb(tx.client) });
    },
  };

  it("analyse une offre importée de bout en bout", async () => {
    llm.respondWith(EXTRACTION);
    await startWorker(boss, { db: createDb(pool), pool, llm });
    const userId = (await createUser(db, { email: "w@exemple.fr", displayName: "W", password: "un mot de passe solide" })).id;
    const result = await importOffer(offerDeps, userId, { kind: "text", text: OFFER_TEXT });
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

  it("lance le matching sans clic après l'analyse quand un profil est validé (règles seules sans fournisseur autorisé)", async () => {
    const userId = (await createUser(db, { email: "m@exemple.fr", displayName: "M", password: "un mot de passe solide" })).id;
    const { content } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "camille@exemple.fr", phone: null });
    await startDraft(db, userId);
    await saveDraft(db, userId, content);
    expect((await validateDraft(db, userId)).ok).toBe(true);
    // Le worker du premier test répond à l'extraction, puis aucun fournisseur n'est autorisé pour le profil.
    llm.respondWith(EXTRACTION).failWith(new LlmError("no_provider", "Aucun fournisseur autorisé pour les données personnelles", false));
    const result = await importOffer(offerDeps, userId, { kind: "text", text: `${OFFER_TEXT}\nPoste basé à Lyon.` });
    if (!result.ok) throw new Error("import attendu");

    const deadline = Date.now() + 15_000;
    let match: { status: string; mode: string | null; score: number | null } | undefined;
    while (Date.now() < deadline) {
      [match] = await db.select({ status: matchAnalyses.status, mode: matchAnalyses.mode, score: matchAnalyses.score }).from(matchAnalyses).where(eq(matchAnalyses.offerId, result.offerId));
      if (match?.status === "done") break;
      await new Promise((r) => setTimeout(r, 200));
    }
    expect(match).toMatchObject({ status: "done", mode: "rules_only" });
    expect(typeof match!.score).toBe("number");
  }, 20_000);
});
