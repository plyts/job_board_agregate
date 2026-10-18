import "server-only";
import { getDb, getPool } from "@/db/client";
import type { ApplicationsDeps, LetterRequestDeps } from "@/modules/applications";
import { getBoss, getStorage, letterJobOptions, transactionDb } from "@/modules/platform";

export function getApplicationsDeps(): ApplicationsDeps {
  return { db: getDb(), pool: getPool(), storage: getStorage() };
}

export function getLetterDeps(): LetterRequestDeps {
  return {
    db: getDb(),
    pool: getPool(),
    enqueueLetter: async (tx, job) => {
      const boss = await getBoss();
      await boss.send("letter.draft", job, { ...letterJobOptions(job.applicationId), db: transactionDb(tx.client) });
    },
  };
}
