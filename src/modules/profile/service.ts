import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, lt, max, notInArray, or } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { profileVersions, type ProfileUncertainty } from "@/db/schema";
import { withTransaction, type TxContext } from "@/db/transaction";
import { FileImportError } from "@/modules/offers/files";
import { generateJournaled } from "@/modules/platform/llm/journal";
import type { LlmRouter } from "@/modules/platform/llm/router";
import type { ObjectStorage } from "@/modules/platform/storage";
import { LlmError, type LlmClient } from "@/modules/platform/llm/types";
import { profileQuality } from "@/modules/cv/quality";
import { mergeCounts, PII_LABELS, PII_RULES_VERSION, redactPii, restorePlaceholders, type PrivacyReport } from "@/modules/privacy/pii";
import { emptyProfile, newElementId, ProfileContent, validationProblems } from "./content";
import {
  buildProfileUserMessage,
  PROFILE_PROMPT_VERSION,
  PROFILE_SCHEMA_VERSION,
  PROFILE_SYSTEM,
  ProfileExtraction,
  readCvFile,
  toProfileContent,
} from "./extract";

export type ProfileVersion = typeof profileVersions.$inferSelect;

export async function getCurrentProfile(db: Db, userId: string): Promise<ProfileVersion | null> {
  const [row] = await db
    .select()
    .from(profileVersions)
    .where(and(eq(profileVersions.userId, userId), eq(profileVersions.status, "validated")))
    .orderBy(desc(profileVersions.version))
    .limit(1);
  return row ?? null;
}

export async function getDraft(db: Db, userId: string): Promise<ProfileVersion | null> {
  const [row] = await db
    .select()
    .from(profileVersions)
    .where(and(eq(profileVersions.userId, userId), eq(profileVersions.status, "draft")))
    .limit(1);
  return row ?? null;
}

export async function listVersions(db: Db, userId: string) {
  return db
    .select({
      id: profileVersions.id,
      version: profileVersions.version,
      status: profileVersions.status,
      origin: profileVersions.origin,
      createdAt: profileVersions.createdAt,
      validatedAt: profileVersions.validatedAt,
      quality: profileVersions.quality,
    })
    .from(profileVersions)
    .where(eq(profileVersions.userId, userId))
    .orderBy(desc(profileVersions.version));
}

export async function getVersion(db: Db, userId: string, versionId: string): Promise<ProfileVersion | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const [row] = await db
    .select()
    .from(profileVersions)
    .where(and(eq(profileVersions.userId, userId), eq(profileVersions.id, versionId)))
    .limit(1);
  return row ?? null;
}

async function nextVersion(db: Db, userId: string): Promise<number> {
  const [row] = await db.select({ v: max(profileVersions.version) }).from(profileVersions).where(eq(profileVersions.userId, userId));
  return (row?.v ?? 0) + 1;
}

/** Ouvre un brouillon à partir de la version courante (ou d'un profil vide). Renvoie le brouillon existant s'il y en a un. */
export async function startDraft(db: Db, userId: string): Promise<ProfileVersion> {
  const existing = await getDraft(db, userId);
  if (existing) return existing;
  const current = await getCurrentProfile(db, userId);
  const [row] = await db
    .insert(profileVersions)
    .values({
      userId,
      version: await nextVersion(db, userId),
      status: "draft",
      content: current?.content ?? emptyProfile(),
      origin: current ? "edit" : "manual",
    })
    .returning();
  return row!;
}

export type SaveResult = { ok: true } | { ok: false; error: string };

export async function saveDraft(db: Db, userId: string, content: unknown): Promise<SaveResult> {
  const parsed = ProfileContent.safeParse(content);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: `Profil invalide${issue ? ` (${issue.path.join(".")} : ${issue.message})` : ""}.` };
  }
  const rows = await db
    .update(profileVersions)
    .set({ content: parsed.data, updatedAt: new Date() })
    .where(
      and(
        eq(profileVersions.userId, userId),
        eq(profileVersions.status, "draft"),
        // Pendant l'extraction, une saisie serait écrasée par le résultat.
        notInArray(profileVersions.importStatus, ["queued", "extracting"]),
      ),
    )
    .returning({ id: profileVersions.id });
  return rows.length ? { ok: true } : { ok: false, error: "Aucun brouillon modifiable : extraction en cours ou brouillon absent." };
}

export async function resolveUncertainty(db: Db, userId: string, uncertaintyId: string): Promise<void> {
  const draft = await getDraft(db, userId);
  if (!draft) return;
  await db
    .update(profileVersions)
    .set({ uncertainties: draft.uncertainties.filter((u) => u.id !== uncertaintyId), updatedAt: new Date() })
    .where(eq(profileVersions.id, draft.id));
}

export type ValidateResult = { ok: true; version: number } | { ok: false; problems: string[] };

/** Valide le brouillon : il devient la nouvelle version du profil maître, désormais immuable. */
export async function validateDraft(db: Db, userId: string): Promise<ValidateResult> {
  const draft = await getDraft(db, userId);
  if (!draft) return { ok: false, problems: ["Aucun brouillon en cours."] };
  if (draft.importStatus === "queued" || draft.importStatus === "extracting") return { ok: false, problems: ["L'extraction du CV est en cours."] };
  const problems = [
    ...draft.uncertainties.map((u) => `À vérifier : ${u.field} — ${u.note}`),
    ...validationProblems(draft.content),
  ];
  if (problems.length) return { ok: false, problems };
  await db
    .update(profileVersions)
    .set({ status: "validated", validatedAt: new Date(), updatedAt: new Date(), quality: profileQuality(draft.content) })
    .where(eq(profileVersions.id, draft.id));
  return { ok: true, version: draft.version };
}

/** Supprime le brouillon et, s'il venait d'un import, le fichier CV stocké (aucune copie orpheline). */
export async function discardDraft(deps: { db: Db; storage: ObjectStorage }, userId: string): Promise<void> {
  const rows = await deps.db
    .delete(profileVersions)
    .where(and(eq(profileVersions.userId, userId), eq(profileVersions.status, "draft")))
    .returning({ key: profileVersions.sourceFileKey });
  for (const r of rows) if (r.key) await deps.storage.delete(r.key).catch(() => {});
}

/**
 * Conservation limitée (RGPD, minimisation) : le texte et le fichier du CV importé ne servent plus une fois
 * la version validée ; ils sont effacés après `days` jours. Le profil validé, lui, ne change pas.
 */
export async function purgeImportedSources(deps: { db: Db; storage: ObjectStorage }, days: number, now = new Date()): Promise<number> {
  const before = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const rows = await deps.db
    .select({ id: profileVersions.id, key: profileVersions.sourceFileKey })
    .from(profileVersions)
    .where(
      and(
        eq(profileVersions.status, "validated"),
        lt(profileVersions.validatedAt, before),
        or(isNotNull(profileVersions.sourceText), isNotNull(profileVersions.sourceFileKey)),
      ),
    )
    .limit(200);
  for (const r of rows) {
    if (r.key) await deps.storage.delete(r.key).catch(() => {});
    await deps.db.update(profileVersions).set({ sourceText: null, sourceFileKey: null }).where(eq(profileVersions.id, r.id));
  }
  return rows.length;
}

/** Durée de conservation du CV source après validation, en jours (`CV_SOURCE_RETENTION_DAYS`, 30 par défaut). */
export function sourceRetentionDays(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.CV_SOURCE_RETENTION_DAYS ?? 30);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : 30;
}

export type ProfileDeps = {
  db: Db;
  pool: Pool;
  storage: ObjectStorage;
  enqueueExtraction: (tx: TxContext, job: { versionId: string; userId: string }) => Promise<void>;
};

export type ImportCvResult = { ok: true; versionId: string } | { ok: false; error: string };

/** Importe un CV : lecture du fichier, création d'un brouillon et mise en file de l'extraction, atomiquement. */
export async function importCv(deps: ProfileDeps, userId: string, bytes: Buffer, opts: { declaredName?: string } = {}): Promise<ImportCvResult> {
  if (await getDraft(deps.db, userId)) {
    return { ok: false, error: "Un brouillon est déjà en cours : valide-le ou supprime-le avant d'importer un nouveau CV." };
  }
  let file;
  try {
    file = await readCvFile(bytes);
  } catch (err) {
    if (err instanceof FileImportError) return { ok: false, error: err.message };
    throw err;
  }
  const current = await getCurrentProfile(deps.db, userId);
  const key = `${userId}/cv/${randomUUID()}.${file.extension}`;
  await deps.storage.put(key, bytes);
  try {
    const versionId = await withTransaction(deps.pool, async (tx) => {
      const [row] = await tx.db
        .insert(profileVersions)
        .values({
          userId,
          version: await nextVersion(tx.db, userId),
          status: "draft",
          // Nom déclaré ou déjà connu : sert à masquer l'identité avant l'envoi à l'IA.
          content: { ...emptyProfile(), identity: { ...emptyProfile().identity, fullName: opts.declaredName || current?.content.identity.fullName || "" } },
          origin: "import",
          importStatus: "queued",
          sourceFileKey: key,
          sourceText: file.text,
        })
        .returning({ id: profileVersions.id });
      await deps.enqueueExtraction(tx, { versionId: row!.id, userId });
      return row!.id;
    });
    return { ok: true, versionId };
  } catch (err) {
    await deps.storage.delete(key).catch(() => {});
    throw err;
  }
}

/** Extractions restées en attente ou bloquées (quotas atteints, worker arrêté) : à remettre en file. */
export async function findStalledExtractions(db: Db, olderThan: Date) {
  return db
    .select({ versionId: profileVersions.id, userId: profileVersions.userId })
    .from(profileVersions)
    .where(and(eq(profileVersions.status, "draft"), inArray(profileVersions.importStatus, ["queued", "extracting"]), lt(profileVersions.updatedAt, olderThan)))
    .limit(100);
}

export type ExtractionDeps = { db: Db; llm: LlmClient | LlmRouter; budgetUsd?: number };

export type ExtractionOutcome =
  | { kind: "extracted"; uncertainties: number }
  | { kind: "skipped" }
  | { kind: "deferred"; reason: string }
  | { kind: "failed"; reason: string };

async function setImport(db: Db, id: string, status: ProfileVersion["importStatus"], reason: string | null, extra: Partial<ProfileVersion> = {}) {
  await db.update(profileVersions).set({ importStatus: status, importReason: reason, updatedAt: new Date(), ...extra }).where(eq(profileVersions.id, id));
}

/**
 * Extraction du CV par le modèle. Le CV est une donnée personnelle : seuls les fournisseurs autorisés
 * (`<P>_ALLOW_PERSONAL_DATA=true` ou modèle local) le reçoivent, sans les coordonnées.
 */
export async function extractProfile(
  deps: ExtractionDeps,
  job: { versionId: string; userId: string },
  attempt: { isFinal: boolean } = { isFinal: false },
): Promise<ExtractionOutcome> {
  const { db } = deps;
  const version = await getVersion(db, job.userId, job.versionId);
  if (!version || version.status !== "draft" || !version.sourceText) return { kind: "skipped" };
  if (version.importStatus === "extracted") return { kind: "skipped" };

  await setImport(db, version.id, "extracting", null);
  // Avant : masquage local de toutes les données personnelles du CV (en-tête compris) ; noms connus en renfort.
  const current = await getCurrentProfile(db, job.userId);
  const knownNames = [version.content.identity.fullName, current?.content.identity.fullName];
  const local = redactPii(version.sourceText, { cv: true, names: knownNames });
  const names = [...knownNames, local.found.name];
  let result;
  try {
    result = await generateJournaled(
      db,
      deps.llm,
      job.userId,
      {
        purpose: "profile.extract",
        promptVersion: PROFILE_PROMPT_VERSION,
        schemaVersion: PROFILE_SCHEMA_VERSION,
        dataClass: "personal",
        system: PROFILE_SYSTEM,
        user: buildProfileUserMessage(local.text),
        privacy: { names },
        schema: ProfileExtraction,
        maxTokens: 16000,
        effort: "medium",
      },
      { budgetUsd: deps.budgetUsd },
    );
  } catch (err) {
    if (!(err instanceof LlmError)) throw err;
    if (err.code === "budget_exceeded" || err.code === "quota_exhausted") {
      const reason = "Budget ou quotas IA du jour atteints : l'extraction reprendra automatiquement.";
      await setImport(db, version.id, "queued", reason);
      return { kind: "deferred", reason };
    }
    if (err.code === "no_provider") {
      const reason =
        "Aucun fournisseur IA n'est autorisé et consenti pour recevoir ton CV masqué. Saisis ton profil manuellement, ou configure un modèle local (recommandé) ou donne ton consentement à un fournisseur dans Fournisseurs IA.";
      await setImport(db, version.id, "failed", reason);
      return { kind: "failed", reason };
    }
    if (err.retryable && !attempt.isFinal) {
      await setImport(db, version.id, "failed", `Échec temporaire (${err.message}) : nouvel essai automatique.`);
      throw err;
    }
    const reason = `Extraction impossible : ${err.message}.`;
    await setImport(db, version.id, "failed", reason);
    return { kind: "failed", reason };
  }
  const extracted = toProfileContent(result.output, version.sourceText, { email: local.found.email, phone: local.found.phone });
  // Après : identité réinjectée localement ; une balise reprise par le modèle est signalée à vérifier.
  // Le nom déclaré à l'import (ou celui du profil) prime sur le nom deviné dans l'en-tête.
  const identityName = knownNames.find((n) => n && n.trim()) ?? local.found.name ?? null;
  const restored = restorePlaceholders(extracted.content, identityName);
  const content = restored.value;
  if (identityName) content.identity.fullName = identityName;
  else if (content.identity.fullName.includes("[CANDIDAT]")) content.identity.fullName = "";
  const uncertainties = [
    ...extracted.uncertainties,
    ...restored.leftovers.map((c) => ({ id: newElementId(), field: "Données masquées", note: `Le modèle a repris une balise « ${PII_LABELS[c]} » : vérifie le champ concerné.` })),
    ...(identityName ? [] : [{ id: newElementId(), field: "Identité", note: "Nom non reconnu dans le CV : saisis-le." }]),
  ];
  const privacyReport: PrivacyReport = {
    rulesVersion: PII_RULES_VERSION,
    before: mergeCounts(local.counts, result.privacy?.masked),
    after: result.privacy?.inOutput ?? {},
    sensitive: (local.counts.sensitive ?? 0) > 0,
    sentChars: local.text.length,
  };
  await setImport(db, version.id, "extracted", null, { content, uncertainties: uncertainties as ProfileUncertainty[], privacyReport });
  return { kind: "extracted", uncertainties: uncertainties.length };
}
