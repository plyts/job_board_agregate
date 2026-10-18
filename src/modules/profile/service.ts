import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, max, notInArray } from "drizzle-orm";
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
import { emptyProfile, ProfileContent, validationProblems } from "./content";
import {
  buildProfileUserMessage,
  PROFILE_PROMPT_VERSION,
  PROFILE_SCHEMA_VERSION,
  PROFILE_SYSTEM,
  ProfileExtraction,
  readCvFile,
  redactContacts,
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

export async function discardDraft(db: Db, userId: string): Promise<void> {
  await db.delete(profileVersions).where(and(eq(profileVersions.userId, userId), eq(profileVersions.status, "draft")));
}

export type ProfileDeps = {
  db: Db;
  pool: Pool;
  storage: ObjectStorage;
  enqueueExtraction: (tx: TxContext, job: { versionId: string; userId: string }) => Promise<void>;
};

export type ImportCvResult = { ok: true; versionId: string } | { ok: false; error: string };

/** Importe un CV : lecture du fichier, création d'un brouillon et mise en file de l'extraction, atomiquement. */
export async function importCv(deps: ProfileDeps, userId: string, bytes: Buffer): Promise<ImportCvResult> {
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
          content: emptyProfile(),
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
  const { redacted, email, phone } = redactContacts(version.sourceText);
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
        user: buildProfileUserMessage(redacted),
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
        "Aucun fournisseur IA n'est autorisé à recevoir ton CV. Saisis ton profil manuellement, ou autorise un fournisseur (modèle local recommandé).";
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
  const { content, uncertainties } = toProfileContent(result.output, version.sourceText, { email, phone });
  await setImport(db, version.id, "extracted", null, { content, uncertainties: uncertainties as ProfileUncertainty[] });
  return { kind: "extracted", uncertainties: uncertainties.length };
}
