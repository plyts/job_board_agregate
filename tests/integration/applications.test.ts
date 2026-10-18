import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { applicationDocuments, applicationEvents, applications, boardColumns, jobOffers } from "@/db/schema";
import { analyzeOffer } from "@/modules/analysis";
import {
  addContact,
  APPLICATION_STATUSES,
  checkCoverLetter,
  confirmSend,
  coverLetterFile,
  createApplication,
  deleteContact,
  getApplication,
  getColumnSettings,
  listApplications,
  moveApplication,
  readSentDocument,
  resetColumnSettings,
  saveColumnSettings,
  saveCoverLetter,
  SEND_REQUIRED,
  setNextAction,
} from "@/modules/applications";
import { checkpointCvDraft, exportCvVersion, finalizeCvVersion, recheckCv, startCvDraft } from "@/modules/cv";
import { createUser } from "@/modules/identity";
import { computeMatch, getCvCheck, requestMatch } from "@/modules/matching";
import { importOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LocalFsStorage } from "@/modules/platform/storage";
import { saveDraft, startDraft, validateDraft } from "@/modules/profile";
import { toProfileContent } from "@/modules/profile/extract";
import { minimalPdf } from "../helpers/pdf";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const NOW = new Date("2026-10-18T10:00:00Z");

describe("candidatures", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const root = await mkdtemp(path.join(tmpdir(), "jobpilot-apps-"));
  const storage = new LocalFsStorage(root);
  const deps = { db, pool, storage };
  const noop = { db, pool, enqueueMatch: async () => {} };
  let userId = "";
  let offerId = "";

  async function offerFor(uid: string, suffix = "") {
    const imported = await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, uid, { kind: "text", text: `${OFFER_TEXT}${suffix}` });
    if (!imported.ok) throw new Error("import attendu");
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId: imported.offerId, userId: uid });
    return imported.offerId;
  }

  async function finalizedCv() {
    const m = await requestMatch(noop, userId, offerId);
    if (!m.ok) throw new Error(m.message);
    await computeMatch({ db, pool, llm: null, today: NOW }, { matchId: m.matchId, userId });
    await startCvDraft(db, userId, offerId);
    const r = await recheckCv(noop, userId, offerId);
    if (!r.ok) throw new Error(r.error);
    await computeMatch({ db, pool, llm: null, today: NOW }, { matchId: (await getCvCheck(db, userId, r.versionId))!.match.id, userId });
    expect(await finalizeCvVersion(db, userId, r.versionId, NOW)).toEqual({ ok: true });
    return r.versionId;
  }

  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "a@exemple.fr", displayName: "A", password: "un mot de passe solide" })).id;
    offerId = await offerFor(userId);
    const { content } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "camille@exemple.fr", phone: null });
    await startDraft(db, userId);
    await saveDraft(db, userId, content);
    expect((await validateDraft(db, userId)).ok).toBe(true);
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  it("une seule candidature active par offre, plusieurs par entreprise", async () => {
    const first = await createApplication(db, pool, userId, offerId);
    expect(first).toMatchObject({ ok: true });
    expect(await createApplication(db, pool, userId, offerId)).toMatchObject({ ok: false, code: "APPLICATION_EXISTS" });
    // Autre offre de la même entreprise (Nordwave) : permis.
    const other = await offerFor(userId, "\nAutre poste.");
    expect(await createApplication(db, pool, userId, other)).toMatchObject({ ok: true });
    // Close, l'offre peut repartir ; la rouvrir alors serait un doublon actif.
    if (!first.ok) throw new Error();
    expect(await moveApplication(pool, userId, first.applicationId, "abandoned", NOW)).toEqual({ ok: true, status: "abandoned" });
    const again = await createApplication(db, pool, userId, offerId);
    expect(again).toMatchObject({ ok: true });
    expect(await moveApplication(pool, userId, first.applicationId, "qualified", NOW)).toMatchObject({ ok: false, error: expect.stringContaining("autre candidature active") });
    // Un autre compte ne voit rien.
    const intruder = (await createUser(db, { email: "b@exemple.fr", displayName: "B", password: "un mot de passe solide" })).id;
    expect(await createApplication(db, pool, intruder, offerId)).toMatchObject({ ok: false, code: "NO_OFFER" });
    expect(await getApplication(db, intruder, again.ok ? again.applicationId : "")).toBeNull();
    expect(await listApplications(db, intruder)).toEqual([]);
  });

  it("refuse « Envoyée » sans confirmation et journalise chaque déplacement", async () => {
    const created = await createApplication(db, pool, userId, offerId);
    if (!created.ok) throw new Error(created.message);
    const id = created.applicationId;
    expect((await getApplication(db, userId, id))!.application).toMatchObject({ status: "new_offer", matchScore: null });
    expect(await moveApplication(pool, userId, id, "cv_to_adapt", NOW)).toEqual({ ok: true, status: "cv_to_adapt" });
    expect(await moveApplication(pool, userId, id, "sent", NOW)).toEqual({ ok: false, error: SEND_REQUIRED });
    expect(await moveApplication(pool, userId, id, "tech_interview", NOW)).toEqual({ ok: false, error: SEND_REQUIRED });
    // La base refuse aussi un statut d'après l'envoi sans date d'envoi.
    await expect(db.update(applications).set({ status: "sent" }).where(eq(applications.id, id))).rejects.toMatchObject({ cause: { constraint: "applications_sent_has_date" } });
    const events = (await getApplication(db, userId, id))!.events;
    expect(events.map((e) => [e.type, e.fromStatus, e.toStatus])).toEqual([
      ["created", null, "new_offer"],
      ["status_changed", "new_offer", "cv_to_adapt"],
    ]);
  });

  it("confirme l'envoi : fichier exact copié, haché, figé ; relance proposée ; historique append-only", async () => {
    const versionId = await finalizedCv();
    const created = await createApplication(db, pool, userId, offerId);
    if (!created.ok) throw new Error(created.message);
    const id = created.applicationId;
    expect((await getApplication(db, userId, id))!.application).toMatchObject({ status: "ready", cvVersionId: versionId, nextAction: "Envoyer la candidature" });

    expect(await confirmSend(deps, userId, id, { sentAt: "2026-10-19", channel: "email", file: { kind: "cv_version", cvVersionId: versionId } }, NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("futur"),
    });
    const sent = await confirmSend(deps, userId, id, { sentAt: "2026-10-18", channel: "career_site", file: { kind: "cv_version", cvVersionId: versionId } }, NOW);
    if (!sent.ok) throw new Error(sent.error);
    const exported = await exportCvVersion(db, userId, versionId, "pdf");
    if (!exported.ok) throw new Error();
    // Export reproductible : le fichier figé est exactement celui que l'utilisateur a téléchargé.
    expect(sent.sha256).toBe(createHash("sha256").update(exported.bytes).digest("hex"));

    const app = (await getApplication(db, userId, id))!;
    expect(app.application).toMatchObject({ status: "sent", sentAt: "2026-10-18", channel: "career_site", nextAction: "Relancer si pas de réponse", nextActionAt: "2026-10-25" });
    expect(app.events.at(-1)).toMatchObject({ type: "sent", fromStatus: "ready", toStatus: "sent", payload: { sha256: sent.sha256, channel: "career_site" } });

    expect(await confirmSend(deps, userId, id, { sentAt: "2026-10-18", channel: "email", file: { kind: "cv_version", cvVersionId: versionId } }, NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("ne peut plus être remplacé"),
    });
    expect(await moveApplication(pool, userId, id, "ready", NOW)).toMatchObject({ ok: false });
    expect(await moveApplication(pool, userId, id, "followed_up", NOW)).toEqual({ ok: true, status: "followed_up" });

    const doc = app.documents[0]!;
    await expect(db.update(applicationDocuments).set({ sha256: "x" }).where(eq(applicationDocuments.id, doc.id))).rejects.toMatchObject({ cause: { message: expect.stringContaining("append-only") } });
    await expect(db.delete(applicationDocuments).where(eq(applicationDocuments.id, doc.id))).rejects.toBeTruthy();
    await expect(db.delete(applicationEvents).where(eq(applicationEvents.applicationId, id))).rejects.toBeTruthy();
    // Une offre liée à une candidature ne se supprime pas.
    await expect(db.delete(jobOffers).where(eq(jobOffers.id, offerId))).rejects.toBeTruthy();

    const read = await readSentDocument(deps, userId, doc.id);
    expect(read).toMatchObject({ ok: true, contentType: "application/pdf" });
    // Fichier altéré sur le disque : refusé au téléchargement.
    await writeFile(path.join(root, doc.storageKey), Buffer.from("%PDF-1.4 falsifié"));
    expect(await readSentDocument(deps, userId, doc.id)).toMatchObject({ ok: false, status: 409 });
    const intruder = (await createUser(db, { email: "c@exemple.fr", displayName: "C", password: "un mot de passe solide" })).id;
    expect(await readSentDocument(deps, intruder, doc.id)).toMatchObject({ ok: false, status: 404 });
  });

  it("accepte un autre fichier PDF ou DOCX, jamais un autre format", async () => {
    const created = await createApplication(db, pool, userId, offerId);
    if (!created.ok) throw new Error(created.message);
    const id = created.applicationId;
    expect(await confirmSend(deps, userId, id, { sentAt: "2026-10-17", channel: "other", file: { kind: "upload", fileName: "cv.html", bytes: Buffer.from("<html>") } }, NOW)).toMatchObject({
      ok: false,
      error: expect.stringContaining("PDF ou DOCX"),
    });
    const bytes = minimalPdf(["CV envoyé à la main"]);
    const sent = await confirmSend(deps, userId, id, { sentAt: "2026-10-17", channel: "other", file: { kind: "upload", fileName: "Mon CV ../final", bytes } }, NOW);
    expect(sent).toMatchObject({ ok: true, sha256: createHash("sha256").update(bytes).digest("hex") });
    const app = (await getApplication(db, userId, id))!;
    expect(app.documents[0]).toMatchObject({ fileName: "Mon CV final.pdf", cvVersionId: null });
    expect(app.application.status).toBe("sent");
  });

  it("joint et fige la lettre de motivation seulement si ses faits sont prouvés", async () => {
    const versionId = await finalizedCv();
    const created = await createApplication(db, pool, userId, offerId);
    if (!created.ok) throw new Error(created.message);
    const id = created.applicationId;
    expect(await saveCoverLetter(db, userId, id, "J'ai mené 12 projets dbt.")).toBe(true);
    expect((await checkCoverLetter(db, userId, id))!.issues.map((i) => i.message)).toEqual([
      "Lettre : le chiffre « 12 » n'apparaît pas dans le profil maître.",
      "Lettre : « dbt » est mis en avant sans preuve dans le profil maître.",
    ]);
    const send = { sentAt: "2026-10-18", channel: "email" as const, file: { kind: "cv_version" as const, cvVersionId: versionId }, attachLetter: true };
    expect(await confirmSend(deps, userId, id, send, NOW)).toMatchObject({ ok: false, error: expect.stringContaining("Lettre non jointe") });
    expect((await getApplication(db, userId, id))!.application.sentAt).toBeNull();

    expect(await saveCoverLetter(db, userId, id, "Data Engineer depuis 2021, j'ai industrialisé 30 pipelines Python chez Lumio.\n\nJe serais ravie d'en parler.")).toBe(true);
    expect((await checkCoverLetter(db, userId, id))!.issues).toEqual([]);
    expect(await coverLetterFile(db, userId, id, "pdf")).toMatchObject({ ok: true, contentType: "application/pdf" });
    const sent = await confirmSend(deps, userId, id, send, NOW);
    if (!sent.ok) throw new Error(sent.error);
    const app = (await getApplication(db, userId, id))!;
    expect(app.documents.map((d) => d.kind)).toEqual(["cv", "cover_letter"]);
    const letterDoc = app.documents[1]!;
    expect(app.events.at(-1)!.payload).toMatchObject({ letterSha256: letterDoc.sha256 });
    const read = await readSentDocument(deps, userId, letterDoc.id);
    if (!read.ok) throw new Error(read.message);
    expect(createHash("sha256").update(read.bytes).digest("hex")).toBe(letterDoc.sha256);
    await expect(db.update(applicationDocuments).set({ fileName: "x" }).where(eq(applicationDocuments.id, letterDoc.id))).rejects.toBeTruthy();
  });

  it("gère les contacts d'une candidature, isolés par compte", async () => {
    const created = await createApplication(db, pool, userId, offerId);
    if (!created.ok) throw new Error(created.message);
    const id = created.applicationId;
    expect(await addContact(db, userId, id, { name: "Alex Recruteur", role: "Talent acquisition", email: "alex@nordwave.example", phone: null, url: null, note: "Rencontré au salon" })).toBe(true);
    const intruder = (await createUser(db, { email: "g@exemple.fr", displayName: "G", password: "un mot de passe solide" })).id;
    expect(await addContact(db, intruder, id, { name: "X", role: null, email: null, phone: null, url: null, note: null })).toBe(false);
    const [contact] = (await getApplication(db, userId, id))!.contacts;
    expect(contact).toMatchObject({ name: "Alex Recruteur", role: "Talent acquisition" });
    expect(await deleteContact(db, intruder, contact!.id)).toBe(false);
    expect(await deleteContact(db, userId, contact!.id)).toBe(true);
    expect((await getApplication(db, userId, id))!.contacts).toEqual([]);
  });

  it("enregistre la prochaine action et la journalise", async () => {
    const created = await createApplication(db, pool, userId, offerId);
    if (!created.ok) throw new Error(created.message);
    expect(await setNextAction(pool, userId, created.applicationId, { nextAction: "Appeler le recruteur", nextActionAt: "2026-10-20", followUpDays: 10 })).toEqual({ ok: true });
    const app = (await getApplication(db, userId, created.applicationId))!;
    expect(app.application).toMatchObject({ nextAction: "Appeler le recruteur", nextActionAt: "2026-10-20", followUpDays: 10 });
    expect(app.events.at(-1)).toMatchObject({ type: "next_action_set" });
    expect(await checkpointCvDraft(pool, userId, offerId)).toBeNull();
  });

  it("enregistre le réglage des colonnes par compte : nom, masquage, retour aux colonnes par défaut", async () => {
    const defaults = await getColumnSettings(db, userId);
    expect(defaults).toHaveLength(12);
    expect(defaults.every((c) => c.label === null && !c.hidden)).toBe(true);

    const next = defaults.map((c) => (c.status === "qualified" ? { ...c, label: "À postuler" } : c.status === "followed_up" ? { ...c, hidden: true } : c));
    await saveColumnSettings(db, userId, next);
    expect(await db.select().from(boardColumns).where(eq(boardColumns.userId, userId))).toHaveLength(2);
    const saved = await getColumnSettings(db, userId);
    expect(saved.find((c) => c.status === "qualified")).toEqual({ status: "qualified", label: "À postuler", hidden: false });
    expect(saved.find((c) => c.status === "followed_up")).toEqual({ status: "followed_up", label: null, hidden: true });
    expect(saved.map((c) => c.status)).toEqual([...APPLICATION_STATUSES]);

    const other = (await createUser(db, { email: "k@exemple.fr", displayName: "K", password: "un mot de passe solide" })).id;
    expect((await getColumnSettings(db, other)).every((c) => c.label === null && !c.hidden)).toBe(true);

    await resetColumnSettings(db, userId);
    expect(await getColumnSettings(db, userId)).toEqual(defaults);
  });
});
