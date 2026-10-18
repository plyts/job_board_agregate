import { eq } from "drizzle-orm";
import { createDb, createPool } from "../../src/db/client";
import { matchAnalyses, profileVersions } from "../../src/db/schema";
import { computeMatch } from "../../src/modules/matching";
import { FakeLlmClient } from "../../src/modules/platform/llm/fake";
import { LlmRouter } from "../../src/modules/platform/llm/router";
import { E2E_JUDGEMENT } from "./fixtures";

/** Le worker ne tourne pas pendant les tests e2e : on traite ici les matchings en attente, avec le même jugement simulé. */
export async function drainPendingMatches(): Promise<number> {
  const pool = createPool(process.env.DATABASE_URL!);
  try {
    const db = createDb(pool);
    const pending = await db
      .select({ id: matchAnalyses.id, userId: matchAnalyses.userId, content: profileVersions.content })
      .from(matchAnalyses)
      .innerJoin(profileVersions, eq(profileVersions.id, matchAnalyses.profileVersionId))
      .where(eq(matchAnalyses.status, "pending"));
    for (const m of pending) {
      const judge = new FakeLlmClient("modele-e2e", undefined, "local").respondWith(E2E_JUDGEMENT(m.content));
      const llm = new LlmRouter([{ client: judge, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
      await computeMatch({ db, pool, llm, budgetUsd: 1000, today: new Date("2026-10-18T12:00:00Z") }, { matchId: m.id, userId: m.userId });
    }
    return pending.length;
  } finally {
    await pool.end();
  }
}
