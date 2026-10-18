import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { llmCalls, profileVersions } from "@/db/schema";
import { analyzeOffer, correctRequirement } from "@/modules/analysis";
import { createUser } from "@/modules/identity";
import { computeMatch, DEFAULT_WEIGHTS, getCurrentMatch, requestMatch, updateWeights } from "@/modules/matching";
import { importOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmRouter } from "@/modules/platform/llm/router";
import { LocalFsStorage } from "@/modules/platform/storage";
import { saveDraft, startDraft, validateDraft, type ProfileContent } from "@/modules/profile";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const TODAY = new Date("2026-10-18T12:00:00Z");

describe("matching", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  let userId = "";
  let offerId = "";
  let content: ProfileContent;
  let enqueued: string[] = [];
  const requestDeps = () => ({ db, pool, enqueueMatch: async (_tx: unknown, job: { matchId: string }) => void enqueued.push(job.matchId) });

  beforeEach(async () => {
    await resetDb(db);
    enqueued = [];
    userId = (await createUser(db, { email: "m@exemple.fr", displayName: "M", password: "un mot de passe solide" })).id;
    const imported = await importOffer({ db, pool, storage: new LocalFsStorage("/tmp/jobpilot-unused"), enqueueAnalysis: async () => {} }, userId, { kind: "text", text: OFFER_TEXT });
    if (!imported.ok) throw new Error("import attendu");
    offerId = imported.offerId;
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId, userId });
    const converted = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: null, phone: null });
    content = { ...converted.content, preferences: { ...converted.content.preferences, exclusions: ["sur site"] } };
    await startDraft(db, userId);
    expect(await saveDraft(db, userId, content)).toEqual({ ok: true });
    expect((await validateDraft(db, userId)).ok).toBe(true);
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  async function newMatch() {
    const r = await requestMatch(requestDeps(), userId, offerId);
    if (!r.ok) throw new Error(r.message);
    return r.matchId;
  }

  it("refuse un matching sans profil validé ou sans analyse", async () => {
    const other = (await createUser(db, { email: "o@exemple.fr", displayName: "O", password: "un mot de passe solide" })).id;
    expect(await requestMatch(requestDeps(), other, offerId)).toMatchObject({ ok: false, code: "NO_OFFER" });
    await db.delete(profileVersions).where(eq(profileVersions.userId, other));
    const imported = await importOffer({ db, pool, storage: new LocalFsStorage("/tmp/jobpilot-unused"), enqueueAnalysis: async () => {} }, other, { kind: "text", text: OFFER_TEXT });
    if (!imported.ok) throw new Error("import attendu");
    expect(await requestMatch(requestDeps(), other, imported.offerId)).toMatchObject({ ok: false, code: "NO_ANALYSIS" });
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId: imported.offerId, userId: other });
    expect(await requestMatch(requestDeps(), other, imported.offerId)).toMatchObject({ ok: false, code: "NO_PROFILE" });
  });

  it("combine règles, jugement du modèle et garde-fous, puis calcule un score reproductible", async () => {
    const matchId = await newMatch();
    expect(enqueued).toEqual([matchId]);
    const lumio = content.experiences[0]!.id;
    const project = content.projects[0]!.id;
    const llm = new FakeLlmClient("m", undefined, "local").respondWith({
      items: [
        { requirementRef: "R2", category: "confirmed", evidenceIds: [lumio], rationale: "30 pipelines Python/SQL chez Lumio.", action: "Rien à faire." },
        { requirementRef: "R3", category: "confirmed", evidenceIds: [], rationale: "dbt mentionné.", action: "—" },
        { requirementRef: "R4", category: "confirmed", evidenceIds: [project], rationale: "Projet Databricks.", action: "Préciser le contexte." },
        { requirementRef: "R5", category: "confirmed", evidenceIds: [lumio], rationale: "Ignoré : la règle d'exclusion prime.", action: "—" },
      ],
    });
    const router = new LlmRouter([{ client: llm, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
    expect(await computeMatch({ db, pool, llm: router, today: TODAY }, { matchId, userId })).toEqual({ kind: "done", score: 58, mode: "model" });

    const current = (await getCurrentMatch(db, userId, offerId))!;
    const byLabel = Object.fromEntries(current.items.map((i) => [i.requirement.label, i.item]));
    expect(byLabel["Expérience en data"]).toMatchObject({ category: "confirmed", source: "rule" });
    expect(byLabel["Expérience en data"]?.rationale).toContain("5 ans et 5 mois");
    expect(byLabel["Python et SQL"]).toMatchObject({ category: "confirmed", source: "model" });
    expect(byLabel["Python et SQL"]?.evidence[0]).toMatchObject({ id: lumio, label: "Data Engineer · Lumio" });
    expect(byLabel["dbt"]).toMatchObject({ category: "to_confirm", source: "guard" });
    expect(byLabel["Kubernetes"]).toMatchObject({ category: "partial", source: "guard" });
    expect(byLabel["Présence sur site"]).toMatchObject({ category: "potential_incompatibility", source: "rule" });
    expect(current.profileVersion).toBe(1);
    expect(llm.requests[0]?.dataClass).toBe("personal");

    // Une correction de l'offre après coup ne modifie pas ce matching : il reste reproductible.
    await correctRequirement(db, userId, byLabel["dbt"]!.requirementId, { importance: "mandatory" });
    expect(await updateWeights(db, userId, matchId, DEFAULT_WEIGHTS)).toBe(58);

    // Changer les poids recalcule le score sans nouvel appel au modèle.
    expect(await updateWeights(db, userId, matchId, { mandatory: 100, preferred: 0, experience: 0, conditions: 0 })).toBe(75);
    expect(llm.requests).toHaveLength(1);
  });

  it("bascule en règles seules, clairement signalées, sans fournisseur autorisé pour le profil", async () => {
    const matchId = await newMatch();
    const groq = new FakeLlmClient("m", undefined, "groq");
    const router = new LlmRouter([{ client: groq, policy: { allowsPersonalData: false, requestsPerMinute: null, requestsPerDay: null } }]);
    expect(await computeMatch({ db, pool, llm: router, today: TODAY }, { matchId, userId })).toMatchObject({ kind: "done", mode: "rules_only" });
    expect(groq.requests).toHaveLength(0);
    const current = (await getCurrentMatch(db, userId, offerId))!;
    const judged = current.items.filter((i) => i.item.source === "rule" && i.item.category === "to_confirm");
    expect(judged.length).toBe(3);
    expect(judged[0]?.item.rationale).toContain("aucun fournisseur IA n'est autorisé");
    expect(await computeMatch({ db, pool, llm: null, today: TODAY }, { matchId, userId })).toEqual({ kind: "skipped" });
  });

  it("reporte le calcul quand les quotas sont épuisés et remplace l'ancien matching au suivant", async () => {
    const first = await newMatch();
    const exhausted = new FakeLlmClient("m", undefined, "local");
    // Quota d'un appel par jour, déjà consommé.
    const tight = new LlmRouter([{ client: exhausted, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: 1 } }]);
    await db.insert(llmCalls).values({ userId, purpose: "x", provider: "local", model: "m", promptVersion: "v", schemaVersion: 1, inputHash: "h", status: "ok" });
    expect((await computeMatch({ db, pool, llm: tight, today: TODAY }, { matchId: first, userId })).kind).toBe("deferred");
    expect(exhausted.requests).toHaveLength(0);
    const second = await newMatch();
    expect((await getCurrentMatch(db, userId, offerId))?.match.id).toBe(second);
  });
});
