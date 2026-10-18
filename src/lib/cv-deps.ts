import "server-only";
import { getDb, getPool } from "@/db/client";
import type { CvSuggestDeps } from "@/modules/cv";
import { getBoss, suggestJobOptions, transactionDb } from "@/modules/platform";

export function getCvSuggestDeps(): CvSuggestDeps {
  return {
    db: getDb(),
    pool: getPool(),
    enqueueSuggest: async (tx, job) => {
      const boss = await getBoss();
      await boss.send("cv.suggest", job, { ...suggestJobOptions(job.draftId), db: transactionDb(tx.client) });
    },
  };
}
