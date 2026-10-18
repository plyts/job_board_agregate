import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { applications, llmCalls } from "@/db/schema";
import { analyzeOffer } from "@/modules/analysis";
import { acceptLetterProposal, checkCoverLetter, createApplication, discardLetterProposal, draftLetter, getApplication, requestLetterDraft } from "@/modules/applications";
import { createUser } from "@/modules/identity";
import { importOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmRouter } from "@/modules/platform/llm/router";
import { LocalFsStorage } from "@/modules/platform/storage";
import { getCurrentProfile, saveDraft, startDraft, validateDraft } from "@/modules/profile";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const TODAY = new Date("2026-10-18T10:00:00Z");
const OPEN = { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null };

describe("lettre proposée par l'IA", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const storage = new LocalFsStorage(await mkdtemp(path.join(tmpdir(), "jobpilot-letter-")));
  const queued: { applicationId: string; userId: string }[] = [];
  const deps = { db, pool, enqueueLetter: async (_tx: unknown, job: { applicationId: string; userId: string }) => void queued.push(job) };
  let userId = "";
  let applicationId = "";

  beforeEach(async () => {
    await resetDb(db);
    queued.length = 0;
    userId = (await createUser(db, { email: "l@exemple.fr", displayName: "L", password: "un mot de passe solide" })).id;
    const imported = await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, userId, { kind: "text", text: OFFER_TEXT });
    if (!imported.ok) throw new Error("import attendu");
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId: imported.offerId, userId });
    const { content } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "camille.martin@exemple.fr", phone: null });
    await startDraft(db, userId);
    await saveDraft(db, userId, content);
    expect((await validateDraft(db, userId)).ok).toBe(true);
    const created = await createApplication(db, pool, userId, imported.offerId);
    if (!created.ok) throw new Error(created.message);
    applicationId = created.applicationId;
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  async function profileIds() {
    const profile = (await getCurrentProfile(db, userId))!.content;
    const [lumio, sencia] = profile.experiences;
    return { lumio: lumio!.items[0]!.id, sencia: sencia!.items[0]!.id };
  }

  it("propose une lettre sourcée à partir d'un profil masqué, écarte et signale ce qui n'est pas prouvé, puis la reprend", async () => {
    expect(await requestLetterDraft(deps, userId, applicationId)).toEqual({ ok: true });
    expect(await requestLetterDraft(deps, userId, applicationId)).toEqual({ ok: true });
    expect(queued).toEqual([{ applicationId, userId }]);

    const ids = await profileIds();
    const opening = "Nordwave construit la plateforme de données de ses clients industriels : c'est le travail que je fais aujourd'hui.";
    const body = "Chez Lumio, je développe et maintiens 30 pipelines Python/SQL orchestrés par Airflow.";
    const closing = "[CANDIDAT] serait heureux d'en échanger avec vous lors d'un entretien.";
    const llm = new FakeLlmClient("m", undefined, "local").respondWith({
      paragraphs: [
        { kind: "opening", text: opening, sourceIds: [], covers: [] },
        { kind: "body", text: body, sourceIds: [ids.lumio, "inconnu"], covers: ["Python et SQL"] },
        { kind: "body", text: "Chez Sencia, j'ai déployé dbt sur 12 projets.", sourceIds: [ids.sencia], covers: ["dbt"] },
        { kind: "body", text: "Je suis passionné et rigoureux.", sourceIds: [], covers: [] },
        { kind: "closing", text: closing, sourceIds: [], covers: [] },
      ],
    });
    const outcome = await draftLetter({ db, llm: new LlmRouter([{ client: llm, policy: OPEN }]), today: TODAY }, { applicationId, userId });
    expect(outcome).toEqual({ kind: "done", paragraphs: 4, flagged: 1, dropped: 1 });

    // Avant l'envoi : le profil part masqué, sans nom ni coordonnées.
    const sent = llm.requests[0]!;
    expect(sent.dataClass).toBe("personal");
    for (const leaked of ["Camille", "Martin", "camille.martin@exemple.fr"]) expect(sent.user).not.toContain(leaked);
    expect(sent.user).toContain("30 pipelines Python/SQL");
    expect(sent.user).toContain("Nordwave");
    const [call] = await db.select().from(llmCalls).where(eq(llmCalls.purpose, "letter.draft"));
    expect(call).toMatchObject({ provider: "local", status: "ok" });

    const app = (await getApplication(db, userId, applicationId))!.application;
    expect(app.letterStatus).toBe("done");
    const [p0, p1, p2, p3] = app.letterProposal!.paragraphs;
    expect(app.letterProposal).toMatchObject({ dropped: 1, promptVersion: "letter-draft-v1", llmCallId: call!.id });
    expect(p1).toMatchObject({ text: body, sourceIds: [ids.lumio], issues: [] });
    expect(p2!.issues.join(" ")).toContain("le chiffre « 12 »");
    expect(p2!.issues.join(" ")).toContain("« dbt » est mis en avant sans preuve");
    // Après : la balise du nom est remplacée localement.
    expect(p3!.text).toBe("Camille Martin serait heureux d'en échanger avec vous lors d'un entretien.");
    expect(p0!.issues).toEqual([]);

    expect(await acceptLetterProposal(db, userId, applicationId)).toEqual({ ok: true });
    const accepted = (await getApplication(db, userId, applicationId))!.application;
    expect(accepted.coverLetter).toBe([opening, body, p3!.text].join("\n\n"));
    expect(accepted).toMatchObject({ letterStatus: "none", letterProposal: null });
    expect((await checkCoverLetter(db, userId, applicationId, TODAY))!.issues.filter((i) => i.severity === "blocking")).toEqual([]);
    expect(await acceptLetterProposal(db, userId, applicationId)).toEqual({ ok: false, error: "Aucune proposition à reprendre." });
  });

  it("n'envoie rien à un fournisseur distant sans consentement, et une proposition peut être écartée", async () => {
    await requestLetterDraft(deps, userId, applicationId);
    const groq = new FakeLlmClient("m", undefined, "groq");
    const outcome = await draftLetter({ db, llm: new LlmRouter([{ client: groq, policy: OPEN }]), today: TODAY }, { applicationId, userId });
    expect(outcome).toMatchObject({ kind: "failed" });
    expect(groq.requests).toHaveLength(0);
    const app = (await getApplication(db, userId, applicationId))!.application;
    expect(app).toMatchObject({ letterStatus: "failed", letterReason: expect.stringContaining("autorisé et consenti") });

    // Une demande traitée ou annulée n'est pas rejouée par le worker.
    expect(await draftLetter({ db, llm: null }, { applicationId, userId })).toEqual({ kind: "skipped" });
    await db.update(applications).set({ letterStatus: "done", letterProposal: { paragraphs: [], dropped: 0, promptVersion: "v", llmCallId: "x", createdAt: "" } }).where(eq(applications.id, applicationId));
    expect(await discardLetterProposal(db, userId, applicationId)).toBe(true);
    expect((await getApplication(db, userId, applicationId))!.application).toMatchObject({ letterStatus: "none", letterProposal: null });
  });
});
