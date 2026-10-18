import "server-only";
import { getDb, getPool } from "@/db/client";
import type { MatchRequestDeps } from "@/modules/matching";
import { getBoss, matchJobOptions, transactionDb } from "@/modules/platform";

export function getMatchRequestDeps(): MatchRequestDeps {
  return {
    db: getDb(),
    pool: getPool(),
    enqueueMatch: async (tx, job) => {
      const boss = await getBoss();
      await boss.send("match.compute", job, { ...matchJobOptions(job.matchId), db: transactionDb(tx.client) });
    },
  };
}
