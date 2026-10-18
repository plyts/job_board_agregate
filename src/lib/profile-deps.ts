import "server-only";
import { getDb, getPool } from "@/db/client";
import { extractionJobOptions, getBoss, getStorage, transactionDb } from "@/modules/platform";
import type { ProfileDeps } from "@/modules/profile";

export function getProfileDeps(): ProfileDeps {
  return {
    db: getDb(),
    pool: getPool(),
    storage: getStorage(),
    enqueueExtraction: async (tx, job) => {
      const boss = await getBoss();
      await boss.send("profile.extract", job, { ...extractionJobOptions(job.versionId), db: transactionDb(tx.client) });
    },
  };
}
