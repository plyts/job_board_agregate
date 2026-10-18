import "server-only";
import { getDb, getPool } from "@/db/client";
import type { OfferDeps } from "@/modules/offers";
import { analysisJobOptions, getBoss, getStorage, transactionDb } from "@/modules/platform";

export function getOfferDeps(): OfferDeps {
  return {
    db: getDb(),
    pool: getPool(),
    storage: getStorage(),
    enqueueAnalysis: async (tx, job) => {
      const boss = await getBoss();
      await boss.send("offer.analyze", job, { ...analysisJobOptions(job.offerId), db: transactionDb(tx.client) });
    },
  };
}
