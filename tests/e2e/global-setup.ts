import { eq } from "drizzle-orm";
import { createDb, createPool } from "../../src/db/client";
import { loginAttempts, users } from "../../src/db/schema";
import { runMigrations } from "../../src/db/migrate";
import { analyzeOffer } from "../../src/modules/analysis";
import { createUser, findUserByEmail } from "../../src/modules/identity";
import { importOffer } from "../../src/modules/offers";
import { FakeLlmClient } from "../../src/modules/platform/llm/fake";
import { LocalFsStorage } from "../../src/modules/platform/storage";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { computeMatch, requestMatch } from "../../src/modules/matching";
import { LlmRouter } from "../../src/modules/platform/llm/router";
import { saveDraft, startDraft, validateDraft } from "../../src/modules/profile";
import { toProfileContent } from "../../src/modules/profile/extract";
import { analyzedOfferTitle, E2E_PROFILE_USER, E2E_PROJECTS, E2E_USER } from "./fixtures";

/** Prépare la base e2e : migrations, compte de test et une offre déjà analysée (faux client IA, aucun appel payant). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL est requise pour les tests e2e");
  const pool = createPool(url);
  try {
    const db = createDb(pool);
    await runMigrations(db);
    // Comptes recréés à chaque exécution : état de départ identique (la suppression emporte offres, profil et journal).
    for (const account of [E2E_USER, E2E_PROFILE_USER]) {
      const previous = await findUserByEmail(db, account.email);
      if (previous) await db.delete(users).where(eq(users.id, previous.id));
      // Les échecs volontaires des scénarios précédents ne doivent pas verrouiller le compte.
      await db.delete(loginAttempts).where(eq(loginAttempts.email, account.email));
    }
    const user = await createUser(db, E2E_USER);
    await createUser(db, E2E_PROFILE_USER);

    // Profil maître validé, construit depuis le CV de référence.
    const { content } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: null, phone: null });
    await startDraft(db, user.id);
    await saveDraft(db, user.id, { ...content, preferences: { ...content.preferences, exclusions: ["sur site"] } });
    const validated = await validateDraft(db, user.id);
    if (!validated.ok) throw new Error(`Préparation e2e : ${validated.problems.join(" ; ")}`);
    const lumio = content.experiences[0]!.id;

    // Une offre analysée par projet Playwright : les scénarios qui la modifient ne se gênent pas.
    for (const project of E2E_PROJECTS) {
      const text = `${OFFER_TEXT}\nRéférence ${project}.`;
      const imported = await importOffer(
        { db, pool, storage: new LocalFsStorage("/tmp/jobpilot-e2e-unused"), enqueueAnalysis: async () => {} },
        user.id,
        { kind: "text", text },
      );
      if (!imported.ok) throw new Error(`Préparation e2e : ${imported.message}`);
      // Faux client rattaché au fournisseur « local » : aucun coût fictif dans les statistiques.
      const llm = new FakeLlmClient("modele-e2e", undefined, "local").respondWith({ ...EXTRACTION, title: analyzedOfferTitle(project) });
      await analyzeOffer({ db, pool, llm, budgetUsd: 1000 }, { offerId: imported.offerId, userId: user.id });

      // Matching déjà calculé (le worker ne tourne pas pendant les tests e2e).
      const requested = await requestMatch({ db, pool, enqueueMatch: async () => {} }, user.id, imported.offerId);
      if (!requested.ok) throw new Error(`Préparation e2e : ${requested.message}`);
      const judge = new FakeLlmClient("modele-e2e", undefined, "local").respondWith({
        items: [
          { requirementRef: "R2", category: "confirmed", evidenceIds: [lumio], rationale: "30 pipelines Python/SQL chez Lumio.", action: "Rien à faire." },
          { requirementRef: "R3", category: "not_demonstrated", evidenceIds: [], rationale: "dbt absent du profil.", action: "Ne pas l'ajouter sans expérience réelle." },
          { requirementRef: "R4", category: "confirmed", evidenceIds: [content.projects[0]!.id], rationale: "Projet Databricks.", action: "Préciser le contexte." },
        ],
      });
      const judgeRouter = new LlmRouter([{ client: judge, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
      await computeMatch({ db, pool, llm: judgeRouter, budgetUsd: 1000, today: new Date("2026-10-18T12:00:00Z") }, { matchId: requested.matchId, userId: user.id });
    }
  } finally {
    await pool.end();
  }
}
