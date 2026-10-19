import { randomUUID } from "node:crypto";
import { and, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import type { Pool } from "pg";
import type { Db } from "@/db/client";
import { companies, jobOffers, offerImports } from "@/db/schema";
import { withTransaction, type TxContext } from "@/db/transaction";
import type { ObjectStorage } from "@/modules/platform/storage";
import { extractJobPage } from "./fetch/html";
import { fetchJobPage, PageFetchError, type FetchOptions } from "./fetch/safe-fetch";
import { extractFileText, FileImportError } from "./files";
import { canonicalUrl, cleanText, contentHash, normalizeCompanyName, provisionalTitle } from "./normalize";

export const MIN_TEXT_LENGTH = 100;
export const MAX_TEXT_LENGTH = 60_000;

export type OfferImportInput =
  | { kind: "url"; url: string }
  | { kind: "text"; text: string; url?: string | null }
  | { kind: "file"; bytes: Buffer };

export type ImportErrorCode = "INVALID_URL" | "FETCH_NOT_ALLOWED" | "FETCH_FAILED" | "FILE_REJECTED" | "TEXT_TOO_SHORT" | "TEXT_TOO_LONG";

export type ImportResult =
  | { ok: true; offerId: string; duplicate: boolean }
  | { ok: false; code: ImportErrorCode; message: string };

export type OfferDeps = {
  db: Db;
  pool: Pool;
  storage: ObjectStorage;
  /** Met l'analyse en file dans la transaction de création de l'offre. */
  enqueueAnalysis: (tx: TxContext, job: { offerId: string; userId: string }) => Promise<void>;
  fetchOptions?: FetchOptions;
};

type Draft = {
  source: "url" | "text" | "file";
  text: string;
  originalUrl: string | null;
  canonicalUrl: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  publishedAt: Date | null;
  sourceFileKey: string | null;
};

const FETCH_NOT_ALLOWED = new Set(["blocked_domain", "blocked_port", "disallowed_by_robots", "private_address"]);

async function findDuplicate(db: Db, userId: string, hash: string | null, canonical: string | null): Promise<string | null> {
  const conditions: SQL[] = [];
  if (hash) conditions.push(eq(jobOffers.contentHash, hash));
  if (canonical) conditions.push(eq(jobOffers.canonicalUrl, canonical));
  if (conditions.length === 0) return null;
  const rows = await db
    .select({ id: jobOffers.id })
    .from(jobOffers)
    .where(and(eq(jobOffers.userId, userId), or(...conditions)))
    .limit(1);
  return rows[0]?.id ?? null;
}

async function recordDuplicate(db: Db, userId: string, offerId: string, source: Draft["source"]): Promise<ImportResult> {
  await db.insert(offerImports).values({ userId, offerId, source, outcome: "duplicate" });
  return { ok: true, offerId, duplicate: true };
}

export async function upsertCompany(db: Db, userId: string, name: string): Promise<string | null> {
  const normalizedName = normalizeCompanyName(name);
  if (!normalizedName) return null;
  await db.insert(companies).values({ userId, name: name.trim(), normalizedName }).onConflictDoNothing();
  const [row] = await db
    .select({ id: companies.id })
    .from(companies)
    .where(and(eq(companies.userId, userId), eq(companies.normalizedName, normalizedName)));
  return row?.id ?? null;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && (err as { code: string }).code === "23505";
}

async function buildDraft(deps: OfferDeps, userId: string, input: OfferImportInput): Promise<Draft | ImportResult> {
  if (input.kind === "url") {
    const canonical = canonicalUrl(input.url);
    if (!canonical) return { ok: false, code: "INVALID_URL", message: "Cette URL n'est pas valide." };
    const existing = await findDuplicate(deps.db, userId, null, canonical);
    if (existing) return recordDuplicate(deps.db, userId, existing, "url");
    try {
      const page = await fetchJobPage(input.url, deps.fetchOptions);
      const extracted = page.contentType.includes("text/plain")
        ? { text: cleanText(page.body), title: null, company: null, location: null, publishedAt: null }
        : extractJobPage(page.body);
      return { source: "url", originalUrl: input.url.trim(), canonicalUrl: canonical, sourceFileKey: null, ...extracted };
    } catch (err) {
      if (err instanceof PageFetchError) {
        const notAllowed = FETCH_NOT_ALLOWED.has(err.reason);
        return {
          ok: false,
          code: notAllowed ? "FETCH_NOT_ALLOWED" : "FETCH_FAILED",
          message: `${err.message}. Colle le texte de l'annonce : l'URL sera conservée.`,
        };
      }
      throw err;
    }
  }
  if (input.kind === "text") {
    const url = input.url?.trim() || null;
    const canonical = url ? canonicalUrl(url) : null;
    if (url && !canonical) return { ok: false, code: "INVALID_URL", message: "L'URL d'origine n'est pas valide." };
    return {
      source: "text",
      text: cleanText(input.text),
      originalUrl: url,
      canonicalUrl: canonical,
      title: null,
      company: null,
      location: null,
      publishedAt: null,
      sourceFileKey: null,
    };
  }
  try {
    const file = await extractFileText(input.bytes);
    return {
      source: "file",
      text: file.text,
      originalUrl: null,
      canonicalUrl: null,
      title: null,
      company: null,
      location: null,
      publishedAt: null,
      sourceFileKey: `${userId}/offers/${randomUUID()}.${file.extension}`,
    };
  } catch (err) {
    if (err instanceof FileImportError) return { ok: false, code: "FILE_REJECTED", message: err.message };
    throw err;
  }
}

/**
 * Importe une offre : texte récupéré ou fourni, dédoublonnage (URL canonique puis empreinte du texte),
 * création et mise en file de l'analyse dans une même transaction.
 */
export async function importOffer(deps: OfferDeps, userId: string, input: OfferImportInput): Promise<ImportResult> {
  const draft = await buildDraft(deps, userId, input);
  if ("ok" in draft) return draft;

  if (draft.text.length < MIN_TEXT_LENGTH) {
    return { ok: false, code: "TEXT_TOO_SHORT", message: "Le texte est trop court pour être une annonce complète." };
  }
  if (draft.text.length > MAX_TEXT_LENGTH) {
    return { ok: false, code: "TEXT_TOO_LONG", message: "Le texte dépasse 60 000 caractères : colle uniquement l'annonce." };
  }

  const hash = contentHash(draft.text);
  const existing = await findDuplicate(deps.db, userId, hash, draft.canonicalUrl);
  if (existing) return recordDuplicate(deps.db, userId, existing, draft.source);

  if (draft.sourceFileKey && input.kind === "file") {
    await deps.storage.put(draft.sourceFileKey, input.bytes, draft.sourceFileKey.endsWith(".pdf") ? "application/pdf" : "text/plain");
  }

  try {
    const offerId = await withTransaction(deps.pool, async (tx) => {
      const companyId = draft.company ? await upsertCompany(tx.db, userId, draft.company) : null;
      const [offer] = await tx.db
        .insert(jobOffers)
        .values({
          userId,
          source: draft.source,
          originalUrl: draft.originalUrl,
          canonicalUrl: draft.canonicalUrl,
          title: draft.title ?? provisionalTitle(draft.text),
          companyId,
          location: draft.location,
          rawText: draft.text,
          contentHash: hash,
          sourceFileKey: draft.sourceFileKey,
          publishedAt: draft.publishedAt,
          status: "queued",
        })
        .returning({ id: jobOffers.id });
      await tx.db.insert(offerImports).values({ userId, offerId: offer!.id, source: draft.source, outcome: "created" });
      await deps.enqueueAnalysis(tx, { offerId: offer!.id, userId });
      return offer!.id;
    });
    return { ok: true, offerId, duplicate: false };
  } catch (err) {
    if (draft.sourceFileKey) await deps.storage.delete(draft.sourceFileKey).catch(() => {});
    if (isUniqueViolation(err)) {
      // Import concurrent de la même offre : l'autre requête a gagné.
      const winner = await findDuplicate(deps.db, userId, hash, draft.canonicalUrl);
      if (winner) return recordDuplicate(deps.db, userId, winner, draft.source);
    }
    throw err;
  }
}

export const OFFER_STATUSES = ["incomplete", "queued", "analyzing", "analyzed", "failed", "qualified", "discarded"] as const;
export type OfferStatus = (typeof OFFER_STATUSES)[number];

export const OFFER_ORIGINS = ["url", "text", "file", "france_travail", "adzuna", "career_page", "email_alert"] as const;
export type OfferOrigin = (typeof OFFER_ORIGINS)[number];

export type OfferListFilters = { q?: string; status?: OfferStatus; origin?: OfferOrigin };

export async function listOffers(db: Db, userId: string, filters: OfferListFilters = {}, limit = 100) {
  const conditions: SQL[] = [eq(jobOffers.userId, userId)];
  if (filters.status) conditions.push(eq(jobOffers.status, filters.status));
  if (filters.origin) conditions.push(eq(jobOffers.source, filters.origin));
  const q = filters.q?.trim();
  if (q) {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(jobOffers.title, pattern), ilike(companies.name, pattern), ilike(jobOffers.location, pattern))!);
  }
  return db
    .select({
      id: jobOffers.id,
      title: jobOffers.title,
      company: companies.name,
      location: jobOffers.location,
      source: jobOffers.source,
      status: jobOffers.status,
      statusReason: jobOffers.statusReason,
      publishedAt: jobOffers.publishedAt,
      createdAt: jobOffers.createdAt,
    })
    .from(jobOffers)
    .leftJoin(companies, eq(companies.id, jobOffers.companyId))
    .where(and(...conditions))
    .orderBy(desc(jobOffers.createdAt))
    .limit(limit);
}

export type OfferListItem = Awaited<ReturnType<typeof listOffers>>[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Renvoie null si l'offre n'existe pas ou appartient à un autre utilisateur. */
export async function getOffer(db: Db, userId: string, offerId: string) {
  if (!UUID.test(offerId)) return null;
  const rows = await db
    .select({ offer: jobOffers, company: companies.name })
    .from(jobOffers)
    .leftJoin(companies, eq(companies.id, jobOffers.companyId))
    .where(and(eq(jobOffers.userId, userId), eq(jobOffers.id, offerId)))
    .limit(1);
  const row = rows[0];
  return row ? { ...row.offer, company: row.company } : null;
}
