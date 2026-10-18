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
import { finalizeCvVersion, generateSuggestions, recheckCv, requestSuggestions, startCvDraft } from "../../src/modules/cv";
import { computeMatch, getCvCheck, requestMatch } from "../../src/modules/matching";
import { LlmRouter } from "../../src/modules/platform/llm/router";
import { saveDraft, startDraft, validateDraft } from "../../src/modules/profile";
import { toProfileContent } from "../../src/modules/profile/extract";
import { analyzedOfferTitle, applicationOfferTitle, deletableUser, E2E_JUDGEMENT, E2E_PROFILE_USER, E2E_PROJECTS, E2E_USER } from "./fixtures";

/** Prépare la base e2e : migrations, compte de test et une offre déjà analysée (faux client IA, aucun appel payant). */
export default async function globalSetup() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL est requise pour les tests e2e");
  const pool = createPool(url);
  try {
    const db = createDb(pool);
    await runMigrations(db);
    // Comptes recréés à chaque exécution : état de départ identique (la suppression emporte offres, profil et journal).
    const disposable = E2E_PROJECTS.map(deletableUser);
    for (const account of [E2E_USER, E2E_PROFILE_USER, ...disposable]) {
      const previous = await findUserByEmail(db, account.email);
      if (previous) await db.delete(users).where(eq(users.id, previous.id));
      // Les échecs volontaires des scénarios précédents ne doivent pas verrouiller le compte.
      await db.delete(loginAttempts).where(eq(loginAttempts.email, account.email));
    }
    const user = await createUser(db, E2E_USER);
    await createUser(db, E2E_PROFILE_USER);
    for (const account of disposable) await createUser(db, account);

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
      const judge = new FakeLlmClient("modele-e2e", undefined, "local").respondWith(E2E_JUDGEMENT(content));
      const judgeRouter = new LlmRouter([{ client: judge, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
      await computeMatch({ db, pool, llm: judgeRouter, budgetUsd: 1000, today: new Date("2026-10-18T12:00:00Z") }, { matchId: requested.matchId, userId: user.id });

      // Brouillon de CV avec un lot de suggestions déjà passé au garde-fou.
      const cv = await startCvDraft(db, user.id, imported.offerId);
      if (!cv.ok) throw new Error(`Préparation e2e : ${cv.message}`);
      await requestSuggestions({ db, pool, enqueueSuggest: async () => {} }, user.id, imported.offerId);
      const [mission, achievement] = content.experiences[0]!.items;
      const suggester = new FakeLlmClient("modele-e2e", undefined, "local").respondWith({
        suggestions: [
          { kind: "rephrase", targetId: mission!.id, text: "Conception et maintenance de 30 pipelines Python et SQL orchestrés par Airflow.", order: null, sourceIds: [lumio], rationale: "Reprend les termes « Python et SQL » de l'offre.", covers: "Python et SQL" },
          { kind: "rephrase", targetId: achievement!.id, text: "Migration de l'entrepôt vers BigQuery (4 To) avec dbt.", order: null, sourceIds: [], rationale: "Met en avant dbt.", covers: "dbt" },
        ],
      });
      const suggestRouter = new LlmRouter([{ client: suggester, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
      await generateSuggestions({ db, llm: suggestRouter, budgetUsd: 1000 }, { draftId: cv.draft.id, userId: user.id });

      // Seconde offre, CV déjà recontrôlé et finalisé : point de départ du parcours de candidature.
      const second = await importOffer(
        { db, pool, storage: new LocalFsStorage("/tmp/jobpilot-e2e-unused"), enqueueAnalysis: async () => {} },
        user.id,
        { kind: "text", text: `${OFFER_TEXT}\nCandidature ${project}.` },
      );
      if (!second.ok) throw new Error(`Préparation e2e : ${second.message}`);
      const extractor = new FakeLlmClient("modele-e2e", undefined, "local").respondWith({ ...EXTRACTION, title: applicationOfferTitle(project) });
      await analyzeOffer({ db, pool, llm: extractor, budgetUsd: 1000 }, { offerId: second.offerId, userId: user.id });
      const today = new Date("2026-10-18T12:00:00Z");
      const reference = await requestMatch({ db, pool, enqueueMatch: async () => {} }, user.id, second.offerId);
      if (!reference.ok) throw new Error(`Préparation e2e : ${reference.message}`);
      await computeMatch({ db, pool, llm: null, today }, { matchId: reference.matchId, userId: user.id });
      await startCvDraft(db, user.id, second.offerId);
      const rechecked = await recheckCv({ db, pool, enqueueMatch: async () => {} }, user.id, second.offerId);
      if (!rechecked.ok) throw new Error(`Préparation e2e : ${rechecked.error}`);
      await computeMatch({ db, pool, llm: null, today }, { matchId: (await getCvCheck(db, user.id, rechecked.versionId))!.match.id, userId: user.id });
      const finalized = await finalizeCvVersion(db, user.id, rechecked.versionId, today);
      if (!finalized.ok) throw new Error(`Préparation e2e : ${finalized.problems.join(" ; ")}`);
    }
  } finally {
    await pool.end();
  }
}
