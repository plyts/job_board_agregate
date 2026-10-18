import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { profileVersions, users } from "@/db/schema";
import { createUser } from "@/modules/identity";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LlmRouter } from "@/modules/platform/llm/router";
import { LocalFsStorage } from "@/modules/platform/storage";
import {
  discardDraft,
  extractProfile,
  getCurrentProfile,
  getDraft,
  importCv,
  listVersions,
  resolveUncertainty,
  saveDraft,
  startDraft,
  validateDraft,
  type ProfileDeps,
} from "@/modules/profile";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";
import { minimalPdf } from "../helpers/pdf";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

describe("profil maître", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const storageRoot = await mkdtemp(path.join(tmpdir(), "jobpilot-profile-"));
  let userId = "";
  let enqueued: string[] = [];
  const deps = (): ProfileDeps => ({
    db,
    pool,
    storage: new LocalFsStorage(storageRoot),
    enqueueExtraction: async (_tx, job) => {
      enqueued.push(job.versionId);
    },
  });

  beforeEach(async () => {
    await resetDb(db);
    enqueued = [];
    userId = (await createUser(db, { email: "p@exemple.fr", displayName: "P", password: "un mot de passe solide" })).id;
  });
  afterAll(async () => {
    await pool.end();
    await rm(storageRoot, { recursive: true, force: true });
    await closeTestDb();
  });

  async function validatedProfile() {
    const draft = await startDraft(db, userId);
    const content = { ...draft.content, identity: { ...draft.content.identity, fullName: "Camille Martin" } };
    expect(await saveDraft(db, userId, content)).toEqual({ ok: true });
    return validateDraft(db, userId);
  }

  it("crée une version validée à partir d'un brouillon, puis une nouvelle version à la modification suivante", async () => {
    expect(await validatedProfile()).toEqual({ ok: true, version: 1 });
    expect((await getCurrentProfile(db, userId))?.content.identity.fullName).toBe("Camille Martin");

    const draft = await startDraft(db, userId);
    expect(draft).toMatchObject({ version: 2, origin: "edit" });
    expect(draft.content.identity.fullName).toBe("Camille Martin");
    expect((await startDraft(db, userId)).id).toBe(draft.id);
    await saveDraft(db, userId, { ...draft.content, summary: "Data Engineer, 5 ans sur GCP." });
    await validateDraft(db, userId);
    expect((await listVersions(db, userId)).map((v) => [v.version, v.status])).toEqual([
      [2, "validated"],
      [1, "validated"],
    ]);
    expect((await getCurrentProfile(db, userId))?.content.summary).toBe("Data Engineer, 5 ans sur GCP.");
  });

  it("refuse un contenu invalide et une validation incomplète", async () => {
    await startDraft(db, userId);
    expect(await saveDraft(db, userId, { identity: "pas un objet" })).toMatchObject({ ok: false });
    expect(await validateDraft(db, userId)).toEqual({ ok: false, problems: ["Renseigne ton nom."] });
  });

  it("garantit en base qu'une version validée ne change plus", async () => {
    await validatedProfile();
    const v1 = (await getCurrentProfile(db, userId))!;
    // Drizzle enveloppe l'erreur PostgreSQL : on lit sa cause.
    const pgError = (p: Promise<unknown>) => p.then(() => "aucune erreur", (e: { cause?: { message?: string } }) => e.cause?.message ?? "");
    expect(await pgError(db.execute(sql`update profile_versions set content = '{}' where id = ${v1.id}`))).toMatch(/immutable/);
    expect(await pgError(db.update(profileVersions).set({ status: "draft" }).where(eq(profileVersions.id, v1.id)))).toMatch(/immutable/);
    expect(await pgError(db.delete(profileVersions).where(eq(profileVersions.id, v1.id)))).toMatch(/immutable/);
    // La suppression du compte reste possible et emporte tout le profil.
    await db.delete(users).where(eq(users.id, userId));
    expect(await db.select().from(profileVersions)).toHaveLength(0);
  });

  it("importe un CV, refuse un second import tant qu'un brouillon existe, et le supprime proprement", async () => {
    const pdf = minimalPdf(["Camille Martin, Data Engineer a Lyon.", "Lumio : 30 pipelines Python orchestres par Airflow.", "Master Informatique, Universite de Lyon, 2021."]);
    const result = await importCv(deps(), userId, pdf);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(enqueued).toEqual([result.versionId]);
    const draft = await getDraft(db, userId);
    expect(draft).toMatchObject({ origin: "import", importStatus: "queued" });
    expect(draft?.sourceText).toContain("Camille Martin");
    expect(await saveDraft(db, userId, draft!.content)).toMatchObject({ ok: false });
    expect(await importCv(deps(), userId, pdf)).toMatchObject({ ok: false });
    await discardDraft(db, userId);
    expect(await getDraft(db, userId)).toBeNull();
  });

  async function importedDraftId() {
    const r = await importCv(deps(), userId, minimalPdf(CV_TEXT.split("\n").map((l) => l.normalize("NFD").replace(/[̀-ͯ]/g, "") || " ")));
    if (!r.ok) throw new Error(r.error);
    // Texte source maîtrisé pour le test : celui du CV de référence.
    await db.update(profileVersions).set({ sourceText: CV_TEXT }).where(eq(profileVersions.id, r.versionId));
    return r.versionId;
  }

  it("n'envoie le CV qu'à un fournisseur autorisé pour les données personnelles", async () => {
    const versionId = await importedDraftId();
    const groq = new FakeLlmClient("m", undefined, "groq").respondWith(CV_EXTRACTION);
    const router = new LlmRouter([{ client: groq, policy: { allowsPersonalData: false, requestsPerMinute: null, requestsPerDay: null } }]);
    const outcome = await extractProfile({ db, llm: router }, { versionId, userId });
    expect(outcome.kind).toBe("failed");
    expect(groq.requests).toHaveLength(0);
    expect((await getDraft(db, userId))?.importReason).toContain("Saisis ton profil manuellement");
  });

  it("extrait le profil sans transmettre les coordonnées, puis exige la levée des doutes avant validation", async () => {
    const versionId = await importedDraftId();
    const local = new FakeLlmClient("m", undefined, "local").respondWith(CV_EXTRACTION);
    const router = new LlmRouter([{ client: local, policy: { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null } }]);
    expect(await extractProfile({ db, llm: router }, { versionId, userId })).toEqual({ kind: "extracted", uncertainties: 2 });

    const sent = local.requests[0]!;
    expect(sent.dataClass).toBe("personal");
    expect(sent.user).not.toContain("camille.martin@exemple.fr");
    expect(sent.user).not.toContain("12 34 56 78");

    const draft = (await getDraft(db, userId))!;
    expect(draft).toMatchObject({ importStatus: "extracted" });
    expect(draft.content.identity).toMatchObject({ email: "camille.martin@exemple.fr", phone: "+33 6 12 34 56 78" });
    const blocked = await validateDraft(db, userId);
    expect(blocked.ok).toBe(false);
    for (const u of draft.uncertainties) await resolveUncertainty(db, userId, u.id);
    expect(await validateDraft(db, userId)).toEqual({ ok: true, version: 1 });
    // Rapport de bonnes pratiques figé avec la version validée.
    expect((await getCurrentProfile(db, userId))!.quality).toMatchObject({ rulesVersion: 1, rules: { order: { status: "ok" } } });
    // Idempotent : une version déjà validée n'est pas réextraite.
    expect(await extractProfile({ db, llm: router }, { versionId, userId })).toEqual({ kind: "skipped" });
  });
});
