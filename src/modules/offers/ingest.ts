import { and, eq, gte, inArray, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobOffers, offerImports, offerSightings } from "@/db/schema";
import { normalizeForHash } from "@/lib/text";
import { withTransaction } from "@/db/transaction";
import { extractJobPage } from "./fetch/html";
import { fetchJobPage, PageFetchError } from "./fetch/safe-fetch";
import { canonicalUrl, cleanText, contentHash, normalizeCompanyName } from "./normalize";
import { MAX_TEXT_LENGTH, MIN_TEXT_LENGTH, upsertCompany, type OfferDeps } from "./service";

export type ConnectedOrigin = "france_travail" | "adzuna" | "career_page" | "email_alert";

/** Offre reçue d'une source connectée, déjà normalisée par son connecteur. */
export type IncomingOffer = {
  origin: ConnectedOrigin;
  /** Jobboard d'origine : france_travail, adzuna, greenhouse, linkedin, indeed, wttj… */
  board: string;
  externalId: string | null;
  url: string | null;
  /** Autres adresses de la même annonce (France Travail donne l'URL chez le partenaire) : dédoublonnage. */
  relatedUrls?: string[];
  title: string;
  company: string | null;
  location: string | null;
  publishedAt: Date | null;
  /** Texte complet de l'annonce, ou extrait si `complete` est faux. */
  text: string;
  complete: boolean;
};

export type IngestOutcome =
  | { kind: "created"; offerId: string; complete: boolean }
  | { kind: "duplicate"; offerId: string }
  | { kind: "seen"; offerId: string }
  | { kind: "skipped"; reason: string };

/** Une même annonce sur plusieurs jobboards : même intitulé, même entreprise, même ville. */
export function dedupKey(title: string, company: string | null, location: string | null): string | null {
  const c = company ? normalizeCompanyName(company) : "";
  if (!c) return null;
  const city = normalizeForHash((location ?? "").split(/[,(\-–]/)[0] ?? "").trim();
  const t = normalizeForHash(title)
    .replace(/\b(h|f)\s*\/?\s*(f|h)\b|\bh\/f\b|\bf\/h\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return t ? `${t}|${c}|${city}` : null;
}

/** Fenêtre de rapprochement par intitulé : au-delà, une annonce republiée est traitée comme nouvelle. */
const DEDUP_WINDOW_DAYS = 90;

function partialText(o: IncomingOffer, excerpt: string): string {
  return cleanText(
    [o.title, o.company ?? "", o.location ?? "", "", excerpt, "", o.url ? `Annonce complète : ${o.url}` : ""].join("\n"),
  );
}

async function findExisting(db: Db, userId: string, urls: string[], hash: string | null, key: string | null, now: Date): Promise<string | null> {
  const conditions: SQL[] = [];
  if (urls.length) conditions.push(inArray(jobOffers.canonicalUrl, urls));
  if (hash) conditions.push(eq(jobOffers.contentHash, hash));
  if (key) {
    const since = new Date(now.getTime() - DEDUP_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    conditions.push(and(eq(jobOffers.dedupKey, key), gte(jobOffers.createdAt, since))!);
  }
  if (!conditions.length) return null;
  const [row] = await db
    .select({ id: jobOffers.id })
    .from(jobOffers)
    .where(and(eq(jobOffers.userId, userId), or(...conditions)))
    .limit(1);
  return row?.id ?? null;
}

async function recordSighting(db: Db, userId: string, offerId: string, o: IncomingOffer) {
  await db
    .insert(offerSightings)
    .values({ userId, offerId, origin: o.origin, board: o.board, externalId: o.externalId, url: o.url })
    .onConflictDoNothing();
}

/**
 * Ajoute une offre venue d'une source connectée, sans doublon entre jobboards :
 * déjà vue sur cette source (identifiant externe), même URL (y compris celle d'un partenaire), même texte,
 * ou même intitulé, entreprise et ville sur 90 jours. Une offre complète part en analyse ; un extrait
 * reste « à compléter ». Un texte complet reçu plus tard complète l'offre existante.
 */
export async function ingestOffer(deps: OfferDeps, userId: string, incoming: IncomingOffer, now = new Date()): Promise<IngestOutcome> {
  const title = cleanText(incoming.title).split("\n")[0]?.slice(0, 200) ?? "";
  if (!title) return { kind: "skipped", reason: "offre sans intitulé" };
  const body = cleanText(incoming.text).slice(0, MAX_TEXT_LENGTH);
  const complete = incoming.complete && body.length >= MIN_TEXT_LENGTH;
  const o: IncomingOffer = { ...incoming, title };
  const { db } = deps;

  if (o.externalId) {
    const [seen] = await db
      .select({ id: offerSightings.id, offerId: offerSightings.offerId })
      .from(offerSightings)
      .where(and(eq(offerSightings.userId, userId), eq(offerSightings.board, o.board), eq(offerSightings.externalId, o.externalId)))
      .limit(1);
    if (seen) {
      await db.update(offerSightings).set({ lastSeenAt: now }).where(eq(offerSightings.id, seen.id));
      if (complete) await upgradeIfIncomplete(deps, userId, seen.offerId, body);
      return { kind: "seen", offerId: seen.offerId };
    }
  }

  const urls = [...new Set([o.url, ...(o.relatedUrls ?? [])].map((u) => (u ? canonicalUrl(u) : null)).filter((u): u is string => Boolean(u)))];
  const text = complete ? body : partialText(o, body);
  const hash = contentHash(text);
  const key = dedupKey(title, o.company, o.location);

  const existing = await findExisting(db, userId, urls, complete ? hash : null, key, now);
  if (existing) {
    await recordSighting(db, userId, existing, o);
    await db.insert(offerImports).values({ userId, offerId: existing, source: o.origin, outcome: "duplicate" });
    if (complete) await upgradeIfIncomplete(deps, userId, existing, body);
    return { kind: "duplicate", offerId: existing };
  }

  try {
    const offerId = await withTransaction(deps.pool, async (tx) => {
      const companyId = o.company ? await upsertCompany(tx.db, userId, o.company) : null;
      const [offer] = await tx.db
        .insert(jobOffers)
        .values({
          userId,
          source: o.origin,
          originalUrl: o.url,
          canonicalUrl: urls[0] ?? null,
          title,
          companyId,
          location: o.location,
          rawText: text,
          contentHash: hash,
          publishedAt: o.publishedAt,
          dedupKey: key,
          status: complete ? "queued" : "incomplete",
          statusReason: complete ? null : "Extrait reçu : colle le texte complet de l'annonce, ou récupère la page si le site l'autorise.",
        })
        .returning({ id: jobOffers.id });
      await tx.db.insert(offerImports).values({ userId, offerId: offer!.id, source: o.origin, outcome: "created" });
      await tx.db.insert(offerSightings).values({ userId, offerId: offer!.id, origin: o.origin, board: o.board, externalId: o.externalId, url: o.url });
      if (complete) await deps.enqueueAnalysis(tx, { offerId: offer!.id, userId });
      return offer!.id;
    });
    return { kind: "created", offerId, complete };
  } catch (err) {
    if (typeof err === "object" && err !== null && (err as { code?: string }).code === "23505") {
      // Même annonce importée en parallèle (autre source ou autre exécution) : on la rattache.
      const winner = await findExisting(db, userId, urls, hash, key, now);
      if (winner) {
        await recordSighting(db, userId, winner, o);
        return { kind: "duplicate", offerId: winner };
      }
    }
    throw err;
  }
}

async function upgradeIfIncomplete(deps: OfferDeps, userId: string, offerId: string, text: string) {
  const [offer] = await deps.db
    .select({ status: jobOffers.status })
    .from(jobOffers)
    .where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId)));
  if (offer?.status === "incomplete") await completeOfferText(deps, userId, offerId, text);
}

export type CompleteResult = { ok: true } | { ok: false; error: string; duplicateOf?: string };

/** Texte complet d'une offre « à compléter » (collé ou récupéré) : l'offre part en analyse. */
export async function completeOfferText(deps: OfferDeps, userId: string, offerId: string, raw: string): Promise<CompleteResult> {
  const text = cleanText(raw);
  if (text.length < MIN_TEXT_LENGTH) return { ok: false, error: "Le texte est trop court pour être une annonce complète." };
  if (text.length > MAX_TEXT_LENGTH) return { ok: false, error: "Le texte dépasse 60 000 caractères : colle uniquement l'annonce." };
  const hash = contentHash(text);
  const [other] = await deps.db
    .select({ id: jobOffers.id })
    .from(jobOffers)
    .where(and(eq(jobOffers.userId, userId), eq(jobOffers.contentHash, hash), sql`${jobOffers.id} <> ${offerId}`))
    .limit(1);
  if (other) return { ok: false, error: "Ce texte est déjà celui d'une autre offre.", duplicateOf: other.id };
  const updated = await withTransaction(deps.pool, async (tx) => {
    const rows = await tx.db
      .update(jobOffers)
      .set({ rawText: text, contentHash: hash, status: "queued", statusReason: null, updatedAt: new Date() })
      .where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId), eq(jobOffers.status, "incomplete")))
      .returning({ id: jobOffers.id });
    if (rows.length) await deps.enqueueAnalysis(tx, { offerId, userId });
    return rows.length > 0;
  });
  return updated ? { ok: true } : { ok: false, error: "Cette offre n'attend plus de texte." };
}

/** Récupère la page d'une offre « à compléter », seulement si le site l'autorise (robots.txt, domaines exclus). */
export async function fetchOfferText(deps: OfferDeps, userId: string, offerId: string): Promise<CompleteResult> {
  const [offer] = await deps.db
    .select({ url: jobOffers.originalUrl, status: jobOffers.status })
    .from(jobOffers)
    .where(and(eq(jobOffers.id, offerId), eq(jobOffers.userId, userId)));
  if (!offer) return { ok: false, error: "Offre introuvable." };
  if (offer.status !== "incomplete") return { ok: false, error: "Cette offre n'attend plus de texte." };
  if (!offer.url) return { ok: false, error: "Aucune adresse d'annonce connue : colle le texte." };
  try {
    const page = await fetchJobPage(offer.url, deps.fetchOptions);
    const text = page.contentType.includes("text/plain") ? cleanText(page.body) : extractJobPage(page.body).text;
    return completeOfferText(deps, userId, offerId, text);
  } catch (err) {
    if (err instanceof PageFetchError) return { ok: false, error: `${err.message}. Colle le texte de l'annonce.` };
    throw err;
  }
}
