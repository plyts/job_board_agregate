import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { jobOffers, llmCalls, offerAnalyses, requirementCorrections } from "@/db/schema";
import { analyzeOffer, correctRequirement, decideOffer, findStalledOffers, getCurrentAnalysis } from "@/modules/analysis";
import { createUser } from "@/modules/identity";
import { getOffer, importOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmError } from "@/modules/platform/llm/types";
import { LocalFsStorage } from "@/modules/platform/storage";
import { EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

describe("analyse des offres", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const storage = new LocalFsStorage("/tmp/jobpilot-analysis-unused");
  let userId = "";
  let offerId = "";

  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "a@exemple.fr", displayName: "A", password: "un mot de passe solide" })).id;
    const imported = await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, userId, { kind: "text", text: OFFER_TEXT });
    if (!imported.ok) throw new Error("import attendu");
    offerId = imported.offerId;
  });

  const deps = (llm: FakeLlmClient, budgetUsd?: number) => ({ db, pool, llm, budgetUsd });

  it("enregistre une analyse vérifiée et complète l'offre", async () => {
    const llm = new FakeLlmClient().respondWith(EXTRACTION);
    const outcome = await analyzeOffer(deps(llm), { offerId, userId });
    expect(outcome).toMatchObject({ kind: "analyzed", requirements: 5 });

    const offer = await getOffer(db, userId, offerId);
    expect(offer).toMatchObject({ status: "analyzed", company: "Nordwave", location: "Lyon", title: "Senior Data Engineer" });

    const current = await getCurrentAnalysis(db, userId, offerId);
    expect(current?.analysis.notMentioned).toEqual(["salary", "clearance"]);
    const byLabel = Object.fromEntries(current!.requirements.map((r) => [r.label, r]));
    expect(OFFER_TEXT.slice(byLabel["Python et SQL"]!.quoteStart!, byLabel["Python et SQL"]!.quoteEnd!)).toBe("maîtrise de Python et SQL");
    // Citation inventée par le modèle : déclassée, jamais présentée comme un fait.
    expect(byLabel["Kubernetes"]).toMatchObject({ provenance: "uncertain", quote: null });

    // Le message envoyé au modèle encadre l'annonce comme une donnée.
    expect(llm.requests[0]?.user).toMatch(/<document kind="job_offer" id="[0-9a-f]{16}">/);
    const calls = await db.select().from(llmCalls);
    expect(calls).toHaveLength(1);
    expect(current?.analysis.llmCallId).toBe(calls[0]?.id);
  });

  it("n'analyse pas deux fois la même offre", async () => {
    const llm = new FakeLlmClient().respondWith(EXTRACTION);
    await analyzeOffer(deps(llm), { offerId, userId });
    expect(await analyzeOffer(deps(llm), { offerId, userId })).toEqual({ kind: "skipped", reason: "already_done" });
    expect(llm.requests).toHaveLength(1);
  });

  it("ignore une tâche visant l'offre d'un autre utilisateur", async () => {
    const other = (await createUser(db, { email: "b@exemple.fr", displayName: "B", password: "un mot de passe solide" })).id;
    const llm = new FakeLlmClient();
    expect(await analyzeOffer(deps(llm), { offerId, userId: other })).toEqual({ kind: "skipped", reason: "missing" });
    expect(llm.requests).toHaveLength(0);
  });

  it("relance une erreur temporaire, puis abandonne au dernier essai avec un message clair", async () => {
    const llm = new FakeLlmClient()
      .failWith(new LlmError("api_error", "Erreur de l'API (529)", true))
      .failWith(new LlmError("api_error", "Erreur de l'API (529)", true));
    await expect(analyzeOffer(deps(llm), { offerId, userId })).rejects.toMatchObject({ code: "api_error" });
    expect((await getOffer(db, userId, offerId))?.statusReason).toContain("nouvel essai automatique");
    expect(await analyzeOffer(deps(llm), { offerId, userId }, { isFinal: true })).toMatchObject({ kind: "failed" });
    expect(await getOffer(db, userId, offerId)).toMatchObject({ status: "failed", statusReason: "Analyse impossible : Erreur de l'API (529)." });
  });

  it("ne relance pas un refus du modèle", async () => {
    const llm = new FakeLlmClient().failWith(new LlmError("refused", "refus", false));
    expect(await analyzeOffer(deps(llm), { offerId, userId })).toMatchObject({ kind: "failed", reason: "Le modèle a refusé d'analyser ce contenu." });
  });

  it("reporte l'analyse quand le budget du jour est atteint", async () => {
    const llm = new FakeLlmClient();
    const outcome = await analyzeOffer(deps(llm, 0), { offerId, userId });
    expect(outcome.kind).toBe("deferred");
    expect(await getOffer(db, userId, offerId)).toMatchObject({ status: "queued" });
    expect(llm.requests).toHaveLength(0);
    await db.update(jobOffers).set({ updatedAt: new Date(Date.now() - 3600_000) }).where(eq(jobOffers.id, offerId));
    expect(await findStalledOffers(db, new Date(Date.now() - 15 * 60_000))).toEqual([{ offerId, userId }]);
  });

  it("reporte l'analyse quand les quotas gratuits du jour sont épuisés", async () => {
    const llm = new FakeLlmClient().failWith(new LlmError("quota_exhausted", "Quotas gratuits du jour épuisés", true));
    const outcome = await analyzeOffer(deps(llm), { offerId, userId });
    expect(outcome).toEqual({ kind: "deferred", reason: "Quotas gratuits du jour épuisés : l'analyse reprendra automatiquement." });
    expect(await getOffer(db, userId, offerId)).toMatchObject({ status: "queued" });
  });

  it("une nouvelle analyse remplace la précédente sans la supprimer", async () => {
    const llm = new FakeLlmClient().respondWith(EXTRACTION).respondWith({ ...EXTRACTION, requirements: EXTRACTION.requirements.slice(0, 2) });
    await analyzeOffer(deps(llm), { offerId, userId });
    await db.update(jobOffers).set({ status: "queued" }).where(eq(jobOffers.id, offerId));
    await analyzeOffer(deps(llm), { offerId, userId });
    const all = await db.select().from(offerAnalyses).where(eq(offerAnalyses.offerId, offerId));
    expect(all.map((a) => a.state).sort()).toEqual(["current", "superseded"]);
    expect((await getCurrentAnalysis(db, userId, offerId))?.requirements).toHaveLength(2);
  });

  it("journalise les corrections et masque une exigence retirée", async () => {
    await analyzeOffer(deps(new FakeLlmClient().respondWith(EXTRACTION)), { offerId, userId });
    const current = await getCurrentAnalysis(db, userId, offerId);
    const dbt = current!.requirements.find((r) => r.label === "dbt")!;
    expect(await correctRequirement(db, userId, dbt.id, { importance: "mandatory", value: "2 ans" })).toBe(true);
    const kube = current!.requirements.find((r) => r.label === "Kubernetes")!;
    expect(await correctRequirement(db, userId, kube.id, { removed: true })).toBe(true);

    const after = await getCurrentAnalysis(db, userId, offerId);
    expect(after!.requirements.map((r) => r.label)).not.toContain("Kubernetes");
    expect(after!.requirements.find((r) => r.label === "dbt")).toMatchObject({ importance: "mandatory", value: "2 ans", correctedByUser: true });
    const corrections = await db.select().from(requirementCorrections);
    expect(corrections).toHaveLength(2);
    expect(corrections.find((c) => c.requirementId === dbt.id)).toMatchObject({ before: { importance: "preferred" }, after: { importance: "mandatory" } });

    const other = (await createUser(db, { email: "c@exemple.fr", displayName: "C", password: "un mot de passe solide" })).id;
    expect(await correctRequirement(db, other, dbt.id, { removed: true })).toBe(false);
  });

  it("qualifie ou écarte une offre analysée, jamais une offre en attente", async () => {
    expect(await decideOffer(db, userId, offerId, "qualify")).toBe(false);
    await analyzeOffer(deps(new FakeLlmClient().respondWith(EXTRACTION)), { offerId, userId });
    expect(await decideOffer(db, userId, offerId, "qualify")).toBe(true);
    expect((await getOffer(db, userId, offerId))?.status).toBe("qualified");
    expect(await decideOffer(db, userId, offerId, "discard")).toBe(true);
    expect((await getOffer(db, userId, offerId))?.status).toBe("discarded");
  });
});
