import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createPool } from "@/db/client";
import { llmCalls } from "@/db/schema";
import { withTransaction } from "@/db/transaction";
import { createUser } from "@/modules/identity";
import { createBoss, ensureQueues, transactionDb } from "@/modules/platform/queue";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { generateJournaled, spentTodayUsd } from "@/modules/platform/llm/journal";
import { LlmError, type StructuredRequest } from "@/modules/platform/llm/types";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const Schema = z.object({ title: z.string() });
const request: StructuredRequest<z.infer<typeof Schema>> = {
  purpose: "test.extract",
  promptVersion: "v1",
  schemaVersion: 1,
  dataClass: "public",
  system: "Extrait le titre.",
  user: "<document>Data Engineer</document>",
  schema: Schema,
};

describe("plateforme", async () => {
  const db = await getTestDb();
  let userId = "";
  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "p@exemple.fr", displayName: "P", password: "un mot de passe solide" })).id;
  });
  afterAll(() => closeTestDb());

  describe("appels IA journalisés", () => {
    it("journalise un succès avec ses jetons et son coût", async () => {
      const llm = new FakeLlmClient().respondWith({ title: "Data Engineer" });
      const result = await generateJournaled(db, llm, userId, request);
      expect(result.output.title).toBe("Data Engineer");
      expect(result.costUsd).toBe(0.024);
      const [row] = await db.select().from(llmCalls).where(eq(llmCalls.id, result.callId));
      expect(row).toMatchObject({ status: "ok", purpose: "test.extract", inputTokens: 2000, outputTokens: 800, costUsd: 0.024 });
      expect(row?.inputHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("journalise un échec sans le masquer", async () => {
      const llm = new FakeLlmClient().failWith(new LlmError("refused", "refus", false));
      await expect(generateJournaled(db, llm, userId, request)).rejects.toMatchObject({ code: "refused", retryable: false });
      const rows = await db.select().from(llmCalls);
      expect(rows.map((r) => r.status)).toEqual(["refused"]);
    });

    it("rejette une sortie non conforme au schéma", async () => {
      const llm = new FakeLlmClient().respondWith({ titre: 42 });
      await expect(generateJournaled(db, llm, userId, request)).rejects.toMatchObject({ code: "invalid_output" });
    });

    it("bloque les appels une fois le budget du jour atteint", async () => {
      const llm = new FakeLlmClient().respondWith({ title: "a" }).respondWith({ title: "b" });
      await generateJournaled(db, llm, userId, request, { budgetUsd: 0.03 });
      expect(await spentTodayUsd(db, userId)).toBe(0.024);
      await generateJournaled(db, llm, userId, request, { budgetUsd: 0.03 });
      await expect(generateJournaled(db, llm, userId, request, { budgetUsd: 0.03 })).rejects.toMatchObject({
        code: "budget_exceeded",
        retryable: true,
      });
      expect(llm.requests).toHaveLength(2);
    });
  });

  describe("file de tâches", () => {
    const pool = createPool(TEST_DATABASE_URL);
    const boss = createBoss(TEST_DATABASE_URL, "worker");
    beforeAll(async () => {
      await boss.start();
      // Repart d'une file propre : sa politique a pu changer depuis la dernière exécution.
      await boss.deleteQueue("offer.analyze").catch(() => {});
      await ensureQueues(boss);
    });
    afterAll(async () => {
      await boss.stop({ graceful: false });
      await pool.end();
    });
    beforeEach(async () => {
      await boss.deleteAllJobs("offer.analyze");
    });

    async function countJobs() {
      const r = await db.execute<{ n: number }>(sql`select count(*)::int as n from pgboss.job where name = 'offer.analyze'`);
      return r.rows[0]?.n ?? 0;
    }

    it("annule la mise en file quand la transaction métier échoue", async () => {
      await expect(
        withTransaction(pool, async (tx) => {
          await boss.send("offer.analyze", { offerId: "x" }, { db: transactionDb(tx.client) });
          throw new Error("échec métier");
        }),
      ).rejects.toThrow("échec métier");
      expect(await countJobs()).toBe(0);
    });

    it("valide la mise en file avec la transaction", async () => {
      await withTransaction(pool, (tx) => boss.send("offer.analyze", { offerId: "y" }, { db: transactionDb(tx.client) }));
      expect(await countJobs()).toBe(1);
    });

    it("dédoublonne les envois par clé de singleton", async () => {
      await boss.send("offer.analyze", { offerId: "z" }, { singletonKey: "offer:z" });
      await boss.send("offer.analyze", { offerId: "z" }, { singletonKey: "offer:z" });
      expect(await countJobs()).toBe(1);
    });
  });
});
