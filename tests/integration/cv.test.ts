import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { cvSuggestions, cvVersions, profileVersions } from "@/db/schema";
import { analyzeOffer } from "@/modules/analysis";
import {
  acceptSuggestion,
  checkpointCvDraft,
  exportCvVersion,
  finalizeCvVersion,
  generateSuggestions,
  getCvDraft,
  listCvVersions,
  listSuggestions,
  recheckCv,
  rejectSuggestion,
  requestSuggestions,
  restoreCvVersion,
  saveCvDraft,
  startCvDraft,
  undoSuggestion,
  type CvContent,
} from "@/modules/cv";
import { createUser } from "@/modules/identity";
import { computeMatch, getCurrentMatch, getCvCheck, requestMatch } from "@/modules/matching";
import { importOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmRouter } from "@/modules/platform/llm/router";
import { LocalFsStorage } from "@/modules/platform/storage";
import { saveDraft, startDraft, validateDraft, type ProfileContent } from "@/modules/profile";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const TODAY = new Date("2026-10-18T12:00:00Z");
const local = (llm: FakeLlmClient) => new LlmRouter([{ client: llm, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);

describe("CV personnalisé", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  let userId = "";
  let offerId = "";
  let profile: ProfileContent;
  let enqueued: string[] = [];
  const suggestDeps = () => ({ db, pool, enqueueSuggest: async (_tx: unknown, job: { draftId: string }) => void enqueued.push(job.draftId) });
  const matchDeps = () => ({ db, pool, enqueueMatch: async (_tx: unknown, job: { matchId: string }) => void enqueued.push(job.matchId) });

  async function newUserWithOffer(email: string) {
    const id = (await createUser(db, { email, displayName: "U", password: "un mot de passe solide" })).id;
    const imported = await importOffer({ db, pool, storage: new LocalFsStorage("/tmp/jobpilot-unused"), enqueueAnalysis: async () => {} }, id, { kind: "text", text: OFFER_TEXT });
    if (!imported.ok) throw new Error("import attendu");
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId: imported.offerId, userId: id });
    return { id, offerId: imported.offerId };
  }

  beforeEach(async () => {
    await resetDb(db);
    enqueued = [];
    ({ id: userId, offerId } = await newUserWithOffer("cv@exemple.fr"));
    profile = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "camille@exemple.fr", phone: null }).content;
    await startDraft(db, userId);
    expect(await saveDraft(db, userId, profile)).toEqual({ ok: true });
    expect((await validateDraft(db, userId)).ok).toBe(true);
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  async function draft() {
    const started = await startCvDraft(db, userId, offerId);
    if (!started.ok) throw new Error(started.message);
    return started.draft;
  }

  it("part du profil maître validé, sans jamais le modifier", async () => {
    const other = await newUserWithOffer("autre@exemple.fr");
    expect(await startCvDraft(db, other.id, other.offerId)).toMatchObject({ ok: false, code: "NO_PROFILE" });
    expect(await startCvDraft(db, other.id, offerId)).toMatchObject({ ok: false, code: "NO_OFFER" });

    const d = await draft();
    expect(d).toMatchObject({ version: 1, status: "draft", revision: 0 });
    expect(d.content.experiences).toHaveLength(2);
    expect((await draft()).id).toBe(d.id);

    const edited = structuredClone(d.content);
    edited.experiences[0]!.items[0]!.text = "Conception de 30 pipelines Python/SQL.";
    expect(await saveCvDraft(db, userId, offerId, 0, edited)).toEqual({ ok: true, revision: 1 });
    // Sauvegarde faite sur un état périmé (autre onglet) : refusée.
    expect(await saveCvDraft(db, userId, offerId, 0, edited)).toMatchObject({ ok: false });
    expect(await saveCvDraft(db, userId, offerId, 1, { ...edited, skills: "x" })).toMatchObject({ ok: false });
    const [master] = await db.select().from(profileVersions).where(eq(profileVersions.userId, userId));
    expect(master!.content.experiences[0]!.items[0]!.text).toBe(profile.experiences[0]!.items[0]!.text);
  });

  it("propose des suggestions filtrées par le garde-fou, avec accepter, modifier, refuser et annuler", async () => {
    const d = await draft();
    expect(await requestSuggestions(suggestDeps(), userId, offerId)).toEqual({ ok: true });
    expect(enqueued).toEqual([d.id]);
    const [mission, achievement] = profile.experiences[0]!.items;
    const terraform = profile.skills.find((s) => s.name === "Terraform")!;
    const llm = new FakeLlmClient("m", undefined, "local").respondWith({
      suggestions: [
        { kind: "rephrase", targetId: mission!.id, text: "Conception et maintenance de 30 pipelines Python et SQL sous Airflow.", order: null, sourceIds: [], rationale: "Reprend « Python et SQL ».", covers: "Python et SQL" },
        { kind: "rephrase", targetId: achievement!.id, text: "Migration de 12 To vers BigQuery.", order: null, sourceIds: [], rationale: "Chiffre.", covers: null },
        { kind: "include", targetId: terraform.id, text: null, order: null, sourceIds: [], rationale: "Infra.", covers: null },
        { kind: "summary", text: "Expert dbt.", targetId: null, order: null, sourceIds: ["inventee1"], rationale: "—", covers: "dbt" },
      ],
    });
    expect(await generateSuggestions({ db, llm: local(llm), today: TODAY }, { draftId: d.id, userId })).toEqual({ kind: "done", kept: 1, blocked: 2, dropped: 1 });
    expect(llm.requests[0]?.dataClass).toBe("personal");
    expect(llm.requests[0]?.user).not.toContain("camille@exemple.fr");

    const list = await listSuggestions(db, userId, d.id);
    expect(list.map((s) => s.state)).toEqual(["pending", "blocked", "blocked"]);
    expect(list[1]!.blockReason).toContain("« 12 »");
    expect((await getCvDraft(db, userId, offerId))!.suggestReason).toContain("1 suggestion(s) écartée(s)");

    // Une modification de l'utilisateur repasse par le contrôle des faits.
    expect(await acceptSuggestion(pool, userId, list[0]!.id, "30 pipelines Python sur Kubernetes.", TODAY)).toMatchObject({ ok: false });
    expect(await acceptSuggestion(pool, userId, list[0]!.id, undefined, TODAY)).toEqual({ ok: true });
    let current = (await getCvDraft(db, userId, offerId))!;
    expect(current.content.experiences[0]!.items[0]!.text).toBe("Conception et maintenance de 30 pipelines Python et SQL sous Airflow.");
    expect(current.revision).toBe(1);

    expect(await undoSuggestion(pool, userId, list[0]!.id)).toEqual({ ok: true });
    current = (await getCvDraft(db, userId, offerId))!;
    expect(current.content.experiences[0]!.items[0]!.text).toBe(mission!.text);
    expect(await acceptSuggestion(pool, userId, list[0]!.id, "Conception de 30 pipelines Python et SQL.", TODAY)).toEqual({ ok: true });
    expect((await listSuggestions(db, userId, d.id))[0]).toMatchObject({ state: "edited", text: "Conception de 30 pipelines Python et SQL." });

    expect(await rejectSuggestion(db, userId, list[1]!.id)).toEqual({ ok: true });
    expect(await undoSuggestion(pool, userId, list[1]!.id)).toEqual({ ok: true });
    expect((await listSuggestions(db, userId, d.id))[1]!.state).toBe("blocked");

    // Un autre utilisateur ne peut ni lire ni décider.
    const other = await newUserWithOffer("intrus@exemple.fr");
    expect(await listSuggestions(db, other.id, d.id)).toEqual([]);
    expect(await rejectSuggestion(db, other.id, list[2]!.id)).toMatchObject({ ok: false });
    expect(await acceptSuggestion(pool, other.id, list[2]!.id)).toMatchObject({ ok: false });
  });

  it("refuse en base une suggestion sans source", async () => {
    const d = await draft();
    await expect(
      db.insert(cvSuggestions).values({ userId, cvVersionId: d.id, kind: "summary", text: "Expert.", sourceIds: [], rationale: "—" }),
    ).rejects.toMatchObject({ cause: { message: expect.stringContaining("cv_suggestions_sourced") } });
  });

  it("signale clairement l'absence de fournisseur autorisé pour le CV", async () => {
    const d = await draft();
    await requestSuggestions(suggestDeps(), userId, offerId);
    const groq = new FakeLlmClient("m", undefined, "groq");
    const router = new LlmRouter([{ client: groq, policy: { allowsPersonalData: false, requestsPerMinute: null, requestsPerDay: null } }]);
    expect(await generateSuggestions({ db, llm: router }, { draftId: d.id, userId })).toMatchObject({ kind: "failed" });
    expect(groq.requests).toHaveLength(0);
    expect((await getCvDraft(db, userId, offerId))).toMatchObject({ suggestStatus: "failed" });
    expect((await getCvDraft(db, userId, offerId))!.suggestReason).toContain("adapter toi-même");
  });

  it("fige chaque version enregistrée, la compare et la restaure", async () => {
    const d = await draft();
    const v1 = (await checkpointCvDraft(pool, userId, offerId))!;
    expect(v1).toMatchObject({ version: 1, status: "saved" });
    // Bonnes pratiques figées avec la version, mots-clés de l'offre compris.
    expect(v1.quality).toMatchObject({ rulesVersion: 1, score: expect.any(Number) });
    expect(v1.quality!.keywords!.map((k) => [k.term, k.status])).toContainEqual(["dbt", "gap"]);
    expect((await getCvDraft(db, userId, offerId))!.version).toBe(2);
    // Contenu inchangé : pas de nouvelle version.
    expect((await checkpointCvDraft(pool, userId, offerId))!.id).toBe(v1.id);

    const edited: CvContent = structuredClone(d.content);
    edited.experiences = edited.experiences.slice(0, 1);
    await saveCvDraft(db, userId, offerId, 0, edited);
    const v2 = (await checkpointCvDraft(pool, userId, offerId))!;
    expect(v2.version).toBe(2);
    expect((await listCvVersions(db, userId, offerId)).map((v) => v.version)).toEqual([2, 1]);

    await expect(db.update(cvVersions).set({ content: edited }).where(eq(cvVersions.id, v1.id))).rejects.toMatchObject({ cause: { message: expect.stringContaining("immutable") } });
    await expect(db.delete(cvVersions).where(eq(cvVersions.id, v1.id))).rejects.toMatchObject({ cause: { message: expect.stringContaining("immutable") } });

    expect((await restoreCvVersion(db, userId, v1.id)).ok).toBe(true);
    expect((await getCvDraft(db, userId, offerId))!.content.experiences).toHaveLength(2);
    expect(await restoreCvVersion(db, (await newUserWithOffer("x@exemple.fr")).id, v1.id)).toMatchObject({ ok: false });
  });

  it("recontrôle la version sur ce que le CV montre, puis finalise sans écart factuel", async () => {
    const masterMatch = await requestMatch(matchDeps(), userId, offerId);
    if (!masterMatch.ok) throw new Error(masterMatch.message);
    await computeMatch({ db, pool, llm: null, today: TODAY }, { matchId: masterMatch.matchId, userId });

    const d = await draft();
    const cv = structuredClone(d.content);
    cv.experiences = cv.experiences.slice(0, 1); // Sencia retirée : moins de 5 ans visibles.
    cv.experiences[0]!.items[0]!.text = "Conception de 45 pipelines Python.";
    await saveCvDraft(db, userId, offerId, 0, cv);

    const rechecked = await recheckCv(matchDeps(), userId, offerId);
    if (!rechecked.ok) throw new Error(rechecked.error);
    expect(await finalizeCvVersion(db, userId, rechecked.versionId, TODAY)).toMatchObject({ ok: false, problems: ["Le recontrôle de cette version n'est pas terminé.", "Lumio : le chiffre « 45 » n'apparaît pas dans la source."] });

    const check = (await getCvCheck(db, userId, rechecked.versionId))!;
    await computeMatch({ db, pool, llm: null, today: TODAY }, { matchId: check.match.id, userId });
    const after = (await getCvCheck(db, userId, rechecked.versionId))!;
    const years = (m: typeof after) => m.items.find((i) => i.requirement.kind === "years")!.item.category;
    const before = (await getCurrentMatch(db, userId, offerId))!;
    expect(years(before)).toBe("confirmed");
    expect(years(after)).not.toBe("confirmed");
    expect(after.match.score).toBeLessThan(before.match.score!);

    // Un nouveau matching du profil maître ne remplace pas le recontrôle, et inversement.
    await requestMatch(matchDeps(), userId, offerId);
    expect((await getCvCheck(db, userId, rechecked.versionId))!.match.id).toBe(check.match.id);

    // Correction du chiffre : nouvelle version, nouveau recontrôle, finalisation possible.
    const fixed = (await getCvDraft(db, userId, offerId))!;
    const corrected = structuredClone(fixed.content);
    corrected.experiences[0]!.items[0]!.text = "Conception de 30 pipelines Python.";
    await saveCvDraft(db, userId, offerId, fixed.revision, corrected);
    const second = await recheckCv(matchDeps(), userId, offerId);
    if (!second.ok) throw new Error(second.error);
    const check2 = (await getCvCheck(db, userId, second.versionId))!;
    await computeMatch({ db, pool, llm: null, today: TODAY }, { matchId: check2.match.id, userId });
    expect(await finalizeCvVersion(db, userId, second.versionId, TODAY)).toEqual({ ok: true });
    expect((await listCvVersions(db, userId, offerId))[0]).toMatchObject({ status: "finalized" });
    await expect(db.update(cvVersions).set({ status: "saved" }).where(eq(cvVersions.id, second.versionId))).rejects.toBeTruthy();
  });

  it("exporte une version enregistrée en PDF et DOCX, jamais un brouillon ni la version d'un autre", async () => {
    const d = await draft();
    expect(await exportCvVersion(db, userId, d.id, "pdf")).toMatchObject({ ok: false, status: 404 });
    const v1 = (await checkpointCvDraft(pool, userId, offerId))!;
    expect(await exportCvVersion(db, userId, v1.id, "html")).toMatchObject({ ok: false, status: 400 });
    const pdf = await exportCvVersion(db, userId, v1.id, "pdf");
    expect(pdf).toMatchObject({ ok: true, fileName: "CV-Camille-Martin-Nordwave-v1.pdf", contentType: "application/pdf", finalized: false });
    if (pdf.ok) expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    const docx = await exportCvVersion(db, userId, v1.id, "docx");
    if (docx.ok) expect(Buffer.from(docx.bytes).subarray(0, 2).toString()).toBe("PK");
    const other = await newUserWithOffer("y@exemple.fr");
    expect(await exportCvVersion(db, other.id, v1.id, "pdf")).toMatchObject({ ok: false, status: 404 });
  });

  it("supprime les versions immuables avec l'offre", async () => {
    await draft();
    await checkpointCvDraft(pool, userId, offerId);
    const { jobOffers } = await import("@/db/schema");
    await db.delete(jobOffers).where(eq(jobOffers.id, offerId));
    expect(await db.select().from(cvVersions)).toEqual([]);
    expect(await db.select().from(cvSuggestions)).toEqual([]);
  });
});
