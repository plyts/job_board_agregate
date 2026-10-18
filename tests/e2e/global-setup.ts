import { and, eq } from "drizzle-orm";
import { createDb, createPool } from "../../src/db/client";
import { jobOffers, llmCalls, loginAttempts } from "../../src/db/schema";
import { runMigrations } from "../../src/db/migrate";
import { analyzeOffer } from "../../src/modules/analysis";
import { createUser, findUserByEmail } from "../../src/modules/identity";
import { contentHash, importOffer } from "../../src/modules/offers";
import { FakeLlmClient } from "../../src/modules/platform/llm/fake";
import { LocalFsStorage } from "../../src/modules/platform/storage";
import { EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { analyzedOfferTitle, E2E_PROJECTS, E2E_USER } from "./fixtures";

/** Prépare la base e2e : migrations, compte de test et une offre déjà analysée (faux client IA, aucun appel payant). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL est requise pour les tests e2e");
  const pool = createPool(url);
  try {
    const db = createDb(pool);
    await runMigrations(db);
    const user = (await findUserByEmail(db, E2E_USER.email)) ?? (await createUser(db, E2E_USER));
    await db.delete(llmCalls).where(eq(llmCalls.userId, user.id));
    // Les échecs volontaires des scénarios précédents ne doivent pas verrouiller le compte.
    await db.delete(loginAttempts).where(eq(loginAttempts.email, E2E_USER.email));

    // Une offre analysée par projet Playwright : les scénarios qui la modifient ne se gênent pas.
    for (const project of E2E_PROJECTS) {
      const text = `${OFFER_TEXT}\nRéférence ${project}.`;
      await db.delete(jobOffers).where(and(eq(jobOffers.userId, user.id), eq(jobOffers.contentHash, contentHash(text))));
      const imported = await importOffer(
        { db, pool, storage: new LocalFsStorage("/tmp/jobpilot-e2e-unused"), enqueueAnalysis: async () => {} },
        user.id,
        { kind: "text", text },
      );
      if (!imported.ok) throw new Error(`Préparation e2e : ${imported.message}`);
      // Faux client rattaché au fournisseur « local » : aucun coût fictif dans les statistiques.
      const llm = new FakeLlmClient("modele-e2e", undefined, "local").respondWith({ ...EXTRACTION, title: analyzedOfferTitle(project) });
      await analyzeOffer({ db, pool, llm, budgetUsd: 1000 }, { offerId: imported.offerId, userId: user.id });
    }
  } finally {
    await pool.end();
  }
}
