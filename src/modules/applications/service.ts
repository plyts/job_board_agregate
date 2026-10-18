import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { applicationContacts, applicationDocuments, applicationEvents, applications, companies, cvVersions, jobOffers } from "@/db/schema";
import { withTransaction, type TxContext } from "@/db/transaction";
import { currentRequirements, exportCvVersion, letterFactCheck, offerTermsFrom } from "@/modules/cv";
import { exportLetterDocx, exportLetterPdf, letterFileName } from "@/modules/cv/export";
import { getCurrentMatch } from "@/modules/matching";
import type { ObjectStorage } from "@/modules/platform/storage";
import { getCurrentProfile, getVersion } from "@/modules/profile";
import { addDays, APPLICATION_STATUSES, CLOSED, initialStatus, localDate, moveRefusal, type ApplicationStatus } from "./rules";

export type Application = typeof applications.$inferSelect;
export type ApplicationsDeps = { db: Db; pool: Pool; storage: ObjectStorage };

const UUID = /^[0-9a-f-]{36}$/i;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

export const CHANNELS = {
  career_site: "Site carrière de l'entreprise",
  email: "E-mail au recruteur",
  job_board: "Formulaire du site d'emploi",
  referral: "Recommandation (cooptation)",
  other: "Autre",
} as const;
export type Channel = keyof typeof CHANNELS;

function uniqueViolation(err: unknown, constraint: string): boolean {
  const cause = (err as { cause?: { code?: string; constraint?: string } })?.cause ?? (err as { code?: string; constraint?: string });
  return cause?.code === "23505" && cause.constraint === constraint;
}

async function event(
  tx: TxContext | { db: Db },
  e: { userId: string; applicationId: string; type: "created" | "status_changed" | "sent" | "next_action_set"; from?: ApplicationStatus | null; to?: ApplicationStatus | null; payload?: Record<string, unknown> },
) {
  await tx.db.insert(applicationEvents).values({
    userId: e.userId,
    applicationId: e.applicationId,
    type: e.type,
    fromStatus: e.from ?? null,
    toStatus: e.to ?? null,
    payload: e.payload ?? {},
  });
}

const ACTIVE = APPLICATION_STATUSES.filter((s) => !CLOSED.has(s));

export async function getActiveApplication(db: Db, userId: string, offerId: string): Promise<Application | null> {
  const [row] = await db
    .select()
    .from(applications)
    .where(and(eq(applications.userId, userId), eq(applications.offerId, offerId), inArray(applications.status, ACTIVE)))
    .limit(1);
  return row ?? null;
}

export type CreateApplicationResult =
  | { ok: true; applicationId: string }
  | { ok: false; code: "NO_OFFER" | "APPLICATION_EXISTS"; message: string; applicationId?: string };

/** Ouvre le suivi d'une offre. La colonne de départ reflète l'état réel de l'offre et du CV. */
export async function createApplication(db: Db, pool: Pool, userId: string, offerId: string): Promise<CreateApplicationResult> {
  if (!UUID.test(offerId)) return { ok: false, code: "NO_OFFER", message: "Offre introuvable." };
  const [offer] = await db.select().from(jobOffers).where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId))).limit(1);
  if (!offer) return { ok: false, code: "NO_OFFER", message: "Offre introuvable." };
  const existing = await getActiveApplication(db, userId, offerId);
  if (existing) return { ok: false, code: "APPLICATION_EXISTS", message: "Cette offre a déjà une candidature active.", applicationId: existing.id };

  const versions = await db
    .select({ id: cvVersions.id, status: cvVersions.status })
    .from(cvVersions)
    .where(and(eq(cvVersions.offerId, offerId), eq(cvVersions.userId, userId)))
    .orderBy(desc(cvVersions.version));
  const finalized = versions.find((v) => v.status === "finalized");
  const match = await getCurrentMatch(db, userId, offerId);
  const status = initialStatus(offer.status, Boolean(finalized), versions.length > 0);
  try {
    const id = await withTransaction(pool, async (tx) => {
      const [row] = await tx.db
        .insert(applications)
        .values({
          userId,
          offerId,
          status,
          cvVersionId: finalized?.id ?? null,
          matchScore: match?.match.status === "done" ? match.match.score : null,
          nextAction: status === "ready" ? "Envoyer la candidature" : null,
        })
        .returning({ id: applications.id });
      await event(tx, { userId, applicationId: row!.id, type: "created", to: status, payload: { offerStatus: offer.status } });
      return row!.id;
    });
    return { ok: true, applicationId: id };
  } catch (err) {
    if (uniqueViolation(err, "applications_one_active_per_offer")) {
      const again = await getActiveApplication(db, userId, offerId);
      return { ok: false, code: "APPLICATION_EXISTS", message: "Cette offre a déjà une candidature active.", applicationId: again?.id };
    }
    throw err;
  }
}

export type ApplicationRow = Awaited<ReturnType<typeof listApplications>>[number];

/** Toutes les candidatures, pour le Kanban et la vue tableau. */
export async function listApplications(db: Db, userId: string) {
  return db
    .select({
      id: applications.id,
      status: applications.status,
      matchScore: applications.matchScore,
      nextAction: applications.nextAction,
      nextActionAt: applications.nextActionAt,
      sentAt: applications.sentAt,
      channel: applications.channel,
      updatedAt: applications.updatedAt,
      offerId: jobOffers.id,
      title: jobOffers.title,
      location: jobOffers.location,
      company: companies.name,
    })
    .from(applications)
    .innerJoin(jobOffers, eq(jobOffers.id, applications.offerId))
    .leftJoin(companies, eq(companies.id, jobOffers.companyId))
    .where(eq(applications.userId, userId))
    .orderBy(asc(applications.nextActionAt), desc(applications.updatedAt));
}

export async function getApplication(db: Db, userId: string, applicationId: string) {
  if (!UUID.test(applicationId)) return null;
  const [row] = await db
    .select({ application: applications, offer: jobOffers, company: companies.name })
    .from(applications)
    .innerJoin(jobOffers, eq(jobOffers.id, applications.offerId))
    .leftJoin(companies, eq(companies.id, jobOffers.companyId))
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .limit(1);
  if (!row) return null;
  const [documents, events, versions, contacts] = await Promise.all([
    db.select().from(applicationDocuments).where(eq(applicationDocuments.applicationId, applicationId)).orderBy(asc(applicationDocuments.createdAt)),
    db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId)).orderBy(asc(applicationEvents.occurredAt), asc(applicationEvents.id)),
    db
      .select({ id: cvVersions.id, version: cvVersions.version, status: cvVersions.status, baseProfileVersionId: cvVersions.baseProfileVersionId, finalizedAt: cvVersions.finalizedAt })
      .from(cvVersions)
      .where(and(eq(cvVersions.offerId, row.offer.id), eq(cvVersions.userId, userId), inArray(cvVersions.status, ["saved", "finalized"])))
      .orderBy(desc(cvVersions.version)),
    db.select().from(applicationContacts).where(eq(applicationContacts.applicationId, applicationId)).orderBy(asc(applicationContacts.createdAt)),
  ]);
  return { ...row, documents, events, versions, contacts };
}

export type MoveResult = { ok: true; status: ApplicationStatus } | { ok: false; error: string };

/**
 * Déplace une candidature (Kanban, clavier ou fiche). Chaque déplacement est journalisé.
 * « Envoyée » et les étapes suivantes exigent un envoi confirmé ; une candidature envoyée ne revient pas avant l'envoi.
 */
export async function moveApplication(pool: Pool, userId: string, applicationId: string, to: ApplicationStatus, now = new Date()): Promise<MoveResult> {
  if (!UUID.test(applicationId)) return { ok: false, error: "Candidature introuvable." };
  try {
    return await withTransaction(pool, async (tx): Promise<MoveResult> => {
      const [app] = await tx.db
        .select()
        .from(applications)
        .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
        .for("update")
        .limit(1);
      if (!app) return { ok: false, error: "Candidature introuvable." };
      if (app.status === to) return { ok: true, status: to };
      const refusal = moveRefusal(to, app.sentAt !== null);
      if (refusal) return { ok: false, error: refusal };
      const today = localDate(now);
      const patch: Partial<Application> = { status: to, updatedAt: now };
      if (CLOSED.has(to)) Object.assign(patch, { nextAction: null, nextActionAt: null });
      if (to === "followed_up") {
        Object.assign(patch, {
          nextAction: "Sans réponse : relancer à nouveau ou clore",
          nextActionAt: app.followUpDays ? addDays(today, app.followUpDays) : null,
        });
      }
      await tx.db.update(applications).set(patch).where(eq(applications.id, app.id));
      await event(tx, { userId, applicationId: app.id, type: "status_changed", from: app.status, to, payload: patch.nextActionAt ? { nextActionAt: patch.nextActionAt } : {} });
      return { ok: true, status: to };
    });
  } catch (err) {
    if (uniqueViolation(err, "applications_one_active_per_offer")) return { ok: false, error: "Une autre candidature active existe déjà pour cette offre." };
    throw err;
  }
}

export type NextActionInput = { nextAction: string | null; nextActionAt: string | null; followUpDays: number | null };

export async function setNextAction(pool: Pool, userId: string, applicationId: string, input: NextActionInput): Promise<{ ok: boolean; error?: string }> {
  if (!UUID.test(applicationId)) return { ok: false, error: "Candidature introuvable." };
  return withTransaction(pool, async (tx) => {
    const rows = await tx.db
      .update(applications)
      .set({ nextAction: input.nextAction, nextActionAt: input.nextActionAt, followUpDays: input.followUpDays, updatedAt: new Date() })
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .returning({ id: applications.id });
    if (!rows.length) return { ok: false, error: "Candidature introuvable." };
    await event(tx, { userId, applicationId, type: "next_action_set", payload: { ...input } });
    return { ok: true };
  });
}

export async function saveNotes(db: Db, userId: string, applicationId: string, notes: string): Promise<boolean> {
  if (!UUID.test(applicationId)) return false;
  const rows = await db
    .update(applications)
    .set({ notes: notes.slice(0, 10_000), updatedAt: new Date() })
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .returning({ id: applications.id });
  return rows.length === 1;
}

/** Type du fichier reconnu par sa signature, jamais par son nom. */
export function sniffDocument(bytes: Buffer): { extension: "pdf" | "docx"; contentType: string } | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return { extension: "pdf", contentType: "application/pdf" };
  if (bytes.subarray(0, 4).toString("latin1") === "PK\u0003\u0004") {
    return { extension: "docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" };
  }
  return null;
}

export type SendInput = {
  sentAt: string;
  channel: Channel;
  file: { kind: "cv_version"; cvVersionId: string } | { kind: "upload"; fileName: string; bytes: Buffer };
  /** Joindre la lettre de motivation (figée en PDF avec le CV). */
  attachLetter?: boolean;
};

export type SendResult = { ok: true; documentId: string; sha256: string } | { ok: false; error: string };

/**
 * Confirmation d'envoi par l'utilisateur : le fichier envoyé est copié, haché (SHA-256) et figé ;
 * la candidature passe à « Envoyée » et une relance est proposée. Rien n'est envoyé à la place de l'utilisateur.
 */
export async function confirmSend(deps: ApplicationsDeps, userId: string, applicationId: string, input: SendInput, now = new Date()): Promise<SendResult> {
  const { db } = deps;
  const found = await getApplication(db, userId, applicationId);
  if (!found) return { ok: false, error: "Candidature introuvable." };
  const app = found.application;
  if (app.sentAt) return { ok: false, error: "Envoi déjà confirmé : le fichier envoyé ne peut plus être remplacé." };
  if (CLOSED.has(app.status)) return { ok: false, error: "Candidature close : rouvre-la avant de confirmer un envoi." };
  const today = localDate(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.sentAt) || input.sentAt > today || input.sentAt < "2000-01-01") {
    return { ok: false, error: "Date d'envoi invalide : elle ne peut pas être dans le futur." };
  }
  if (!(input.channel in CHANNELS)) return { ok: false, error: "Canal d'envoi inconnu." };

  let file: { bytes: Buffer; fileName: string; contentType: string; extension: string; cvVersionId: string | null };
  if (input.file.kind === "cv_version") {
    const { cvVersionId } = input.file;
    const version = found.versions.find((v) => v.id === cvVersionId);
    if (!version || version.status !== "finalized") return { ok: false, error: "Choisis une version finalisée du CV de cette offre." };
    const exported = await exportCvVersion(db, userId, version.id, "pdf");
    if (!exported.ok) return { ok: false, error: exported.message };
    file = { bytes: Buffer.from(exported.bytes), fileName: exported.fileName, contentType: exported.contentType, extension: "pdf", cvVersionId: version.id };
  } else {
    const { bytes } = input.file;
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_FILE_BYTES) return { ok: false, error: "Fichier vide ou trop volumineux (10 Mo maximum)." };
    const kind = sniffDocument(bytes);
    if (!kind) return { ok: false, error: "Format non pris en charge : PDF ou DOCX uniquement." };
    // Nom affiché et proposé au téléchargement seulement : la clé de stockage est générée par le serveur.
    const base =
      input.file.fileName
        .replace(/[^\p{L}\p{N}._ -]+/gu, "")
        .replace(/\.{2,}/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 120) || "document";
    const fileName = base.toLowerCase().endsWith(`.${kind.extension}`) ? base : `${base}.${kind.extension}`;
    file = { bytes, fileName, contentType: kind.contentType, extension: kind.extension, cvVersionId: null };
  }

  let letter: { bytes: Buffer; fileName: string; sha256: string; storageKey: string } | null = null;
  if (input.attachLetter) {
    const ctx = await letterContext(db, userId, found, file.cvVersionId);
    if (!app.coverLetter.trim()) return { ok: false, error: "La lettre de motivation est vide." };
    if (!ctx) return { ok: false, error: "Profil maître introuvable pour vérifier la lettre." };
    const blocking = letterFactCheck(app.coverLetter, ctx.profile, ctx.offerTerms, now).filter((i) => i.severity === "blocking");
    if (blocking.length) return { ok: false, error: `Lettre non jointe : ${blocking.map((i) => i.message).join(" ")}` };
    const bytes = Buffer.from(await exportLetterPdf(app.coverLetter, ctx.profile, { ...ctx.meta, date: new Date(`${input.sentAt}T12:00:00Z`) }));
    letter = {
      bytes,
      fileName: letterFileName(ctx.profile, ctx.meta, "pdf"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      storageKey: `applications/${app.id}/${randomUUID()}.pdf`,
    };
  }

  const sha256 = createHash("sha256").update(file.bytes).digest("hex");
  const storageKey = `applications/${app.id}/${randomUUID()}.${file.extension}`;
  await deps.storage.put(storageKey, file.bytes, file.contentType);
  if (letter) await deps.storage.put(letter.storageKey, letter.bytes, "application/pdf");

  try {
    return await withTransaction(deps.pool, async (tx): Promise<SendResult> => {
      const [locked] = await tx.db
        .select()
        .from(applications)
        .where(and(eq(applications.id, app.id), isNull(applications.sentAt)))
        .for("update")
        .limit(1);
      if (!locked) return { ok: false, error: "Envoi déjà confirmé : le fichier envoyé ne peut plus être remplacé." };
      const [doc] = await tx.db
        .insert(applicationDocuments)
        .values({ userId, applicationId: app.id, storageKey, sha256, sizeBytes: file.bytes.byteLength, fileName: file.fileName, contentType: file.contentType, cvVersionId: file.cvVersionId })
        .returning({ id: applicationDocuments.id });
      if (letter) {
        await tx.db.insert(applicationDocuments).values({
          userId,
          applicationId: app.id,
          kind: "cover_letter",
          storageKey: letter.storageKey,
          sha256: letter.sha256,
          sizeBytes: letter.bytes.byteLength,
          fileName: letter.fileName,
          contentType: "application/pdf",
        });
      }
      const followUp = locked.followUpDays ? addDays(input.sentAt, locked.followUpDays) : null;
      await tx.db
        .update(applications)
        .set({
          status: "sent",
          sentAt: input.sentAt,
          channel: input.channel,
          cvVersionId: file.cvVersionId ?? locked.cvVersionId,
          nextAction: followUp ? "Relancer si pas de réponse" : null,
          nextActionAt: followUp,
          updatedAt: now,
        })
        .where(eq(applications.id, app.id));
      await event(tx, {
        userId,
        applicationId: app.id,
        type: "sent",
        from: locked.status,
        to: "sent",
        payload: { sentAt: input.sentAt, channel: input.channel, documentId: doc!.id, sha256, fileName: file.fileName, cvVersionId: file.cvVersionId, followUpAt: followUp, letterSha256: letter?.sha256 ?? null },
      });
      return { ok: true, documentId: doc!.id, sha256 };
    });
  } catch (err) {
    // La copie n'est référencée par aucune ligne : on la retire.
    await deps.storage.delete(storageKey).catch(() => {});
    if (letter) await deps.storage.delete(letter.storageKey).catch(() => {});
    throw err;
  }
}

export type SentDocument = { ok: true; bytes: Buffer; fileName: string; contentType: string } | { ok: false; status: 404 | 409; message: string };

/** Relit le fichier envoyé et vérifie son empreinte avant de le servir. */
export async function readSentDocument(deps: Pick<ApplicationsDeps, "db" | "storage">, userId: string, documentId: string): Promise<SentDocument> {
  if (!UUID.test(documentId)) return { ok: false, status: 404, message: "Document introuvable." };
  const [doc] = await deps.db
    .select()
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.id, documentId), eq(applicationDocuments.userId, userId)))
    .limit(1);
  if (!doc) return { ok: false, status: 404, message: "Document introuvable." };
  let bytes: Buffer;
  try {
    bytes = await deps.storage.get(doc.storageKey);
  } catch {
    return { ok: false, status: 409, message: "Fichier envoyé introuvable dans le stockage." };
  }
  if (createHash("sha256").update(bytes).digest("hex") !== doc.sha256) {
    return { ok: false, status: 409, message: "Le fichier stocké ne correspond plus à son empreinte SHA-256 : il a été altéré." };
  }
  return { ok: true, bytes, fileName: doc.fileName, contentType: doc.contentType };
}

// ---------------------------------------------------------------------------------------------
// Lettre de motivation et contacts

type Found = NonNullable<Awaited<ReturnType<typeof getApplication>>>;

/** Profil de référence (celui du CV choisi, sinon le profil courant), mots-clés de l'offre et en-tête de la lettre. */
async function letterContext(db: Db, userId: string, found: Found, cvVersionId: string | null) {
  const versionId = cvVersionId ?? found.application.cvVersionId;
  const version = found.versions.find((v) => v.id === versionId);
  const base = version ? await getVersion(db, userId, version.baseProfileVersionId) : await getCurrentProfile(db, userId);
  if (!base) return null;
  const requirements = (await currentRequirements(db, userId, found.offer.id)) ?? [];
  return {
    profile: base.content,
    offerTerms: offerTermsFrom(requirements),
    meta: { offerTitle: found.offer.title, company: found.company, date: new Date(), city: base.content.identity.location },
  };
}

export async function saveCoverLetter(db: Db, userId: string, applicationId: string, text: string): Promise<boolean> {
  if (!UUID.test(applicationId) || text.length > 8000) return false;
  const rows = await db
    .update(applications)
    .set({ coverLetter: text, updatedAt: new Date() })
    .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
    .returning({ id: applications.id });
  return rows.length === 1;
}

/** Contrôle des faits de la lettre en brouillon, pour l'affichage. */
export async function checkCoverLetter(db: Db, userId: string, applicationId: string, today = new Date()) {
  const found = await getApplication(db, userId, applicationId);
  if (!found) return null;
  const ctx = await letterContext(db, userId, found, null);
  if (!ctx) return null;
  return { issues: letterFactCheck(found.application.coverLetter, ctx.profile, ctx.offerTerms, today), offerTerms: ctx.offerTerms };
}

export type LetterFile = { ok: true; bytes: Uint8Array; fileName: string; contentType: string } | { ok: false; status: 400 | 404; message: string };

/** Export du brouillon de lettre (aperçu à relire avant l'envoi). */
export async function coverLetterFile(db: Db, userId: string, applicationId: string, format: string): Promise<LetterFile> {
  if (format !== "pdf" && format !== "docx") return { ok: false, status: 400, message: "Format attendu : pdf ou docx." };
  const found = await getApplication(db, userId, applicationId);
  if (!found) return { ok: false, status: 404, message: "Candidature introuvable." };
  if (!found.application.coverLetter.trim()) return { ok: false, status: 404, message: "Lettre vide." };
  const ctx = await letterContext(db, userId, found, null);
  if (!ctx) return { ok: false, status: 404, message: "Profil maître introuvable." };
  const bytes =
    format === "pdf"
      ? await exportLetterPdf(found.application.coverLetter, ctx.profile, ctx.meta)
      : new Uint8Array(await exportLetterDocx(found.application.coverLetter, ctx.profile, ctx.meta));
  return {
    ok: true,
    bytes,
    fileName: letterFileName(ctx.profile, ctx.meta, format),
    contentType: format === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}

export type ContactInput = { name: string; role: string | null; email: string | null; phone: string | null; url: string | null; note: string | null };

export async function addContact(db: Db, userId: string, applicationId: string, input: ContactInput): Promise<boolean> {
  if (!UUID.test(applicationId)) return false;
  const [app] = await db.select({ id: applications.id }).from(applications).where(and(eq(applications.id, applicationId), eq(applications.userId, userId))).limit(1);
  if (!app) return false;
  await db.insert(applicationContacts).values({ userId, applicationId, ...input });
  return true;
}

export async function deleteContact(db: Db, userId: string, contactId: string): Promise<boolean> {
  if (!UUID.test(contactId)) return false;
  const rows = await db
    .delete(applicationContacts)
    .where(and(eq(applicationContacts.id, contactId), eq(applicationContacts.userId, userId)))
    .returning({ id: applicationContacts.id });
  return rows.length === 1;
}

/** Vue par entreprise : offres suivies ou non, candidatures et contacts connus. */
export async function companyOverview(db: Db, userId: string) {
  const offers = await db
    .select({
      offerId: jobOffers.id,
      title: jobOffers.title,
      offerStatus: jobOffers.status,
      companyId: jobOffers.companyId,
      company: companies.name,
      applicationId: applications.id,
      applicationStatus: applications.status,
      sentAt: applications.sentAt,
    })
    .from(jobOffers)
    .leftJoin(companies, eq(companies.id, jobOffers.companyId))
    .leftJoin(applications, eq(applications.offerId, jobOffers.id))
    .where(eq(jobOffers.userId, userId))
    .orderBy(asc(companies.name), asc(jobOffers.title));
  const contacts = await db
    .select({ name: applicationContacts.name, role: applicationContacts.role, companyId: jobOffers.companyId })
    .from(applicationContacts)
    .innerJoin(applications, eq(applications.id, applicationContacts.applicationId))
    .innerJoin(jobOffers, eq(jobOffers.id, applications.offerId))
    .where(eq(applicationContacts.userId, userId));
  const groups = new Map<string, { company: string | null; offers: typeof offers; contacts: { name: string; role: string | null }[] }>();
  for (const o of offers) {
    const key = o.companyId ?? "none";
    const g = groups.get(key) ?? { company: o.company, offers: [], contacts: [] };
    g.offers.push(o);
    groups.set(key, g);
  }
  for (const c of contacts) {
    const g = groups.get(c.companyId ?? "none");
    if (g && !g.contacts.some((x) => x.name === c.name && x.role === c.role)) g.contacts.push({ name: c.name, role: c.role });
  }
  return [...groups.values()].sort((a, b) => b.offers.filter((o) => o.applicationId).length - a.offers.filter((o) => o.applicationId).length || (a.company ?? "~").localeCompare(b.company ?? "~"));
}
