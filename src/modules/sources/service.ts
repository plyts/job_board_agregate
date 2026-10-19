import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { jobOffers, jobSources, offerSightings, savedSearches, syncRuns, type SearchResultItem, type StoredOffer } from "@/db/schema";
import { canonicalUrl, dedupKey, fetchOfferText, ingestOffer, type IncomingOffer, type IngestOutcome, type OfferDeps } from "@/modules/offers";
import { resolveRedirect } from "@/modules/offers/fetch/safe-fetch";
import { decryptSecret, encryptSecret } from "@/modules/platform/secrets";
import { adzunaConnector, ADZUNA } from "./connectors/adzuna";
import { CAREER_PROVIDERS, careerPageConnector, careerPageUrl, detectCareerPage, type CareerEndpoints, type CareerPage } from "./connectors/career-pages";
import { FRANCE_TRAVAIL, franceTravailConnector } from "./connectors/france-travail";
import { boardForSender, BOARDS } from "./email/boards";
import { readNewMessages, testMailbox, type ImapCursor, type ImapOptions, type ImapSettings } from "./email/imap";
import { extractOffers, type Resolver } from "./email/parse";
import { SourceError, type SearchConnector, type SearchQuery } from "./types";

export type JobSource = typeof jobSources.$inferSelect;
export type SavedSearch = typeof savedSearches.$inferSelect;
export type SyncRun = typeof syncRuns.$inferSelect;
export type SourceKind = JobSource["kind"];

/** Adresses des API, remplaçables en test pour viser de faux serveurs locaux. */
export type SourceEndpoints = {
  franceTravail?: { tokenUrl: string; apiUrl: string };
  adzuna?: string;
  careerPages?: CareerEndpoints;
};

export type SourcesDeps = OfferDeps & {
  endpoints?: SourceEndpoints;
  imap?: ImapOptions;
  /** Résolution des liens de suivi des alertes (réseau) ; remplaçable en test. */
  resolve?: Resolver;
};

export type ConnectResult = { ok: true; sourceId: string } | { ok: false; error: string };

const UUID = /^[0-9a-f-]{36}$/i;

/** Adresses des API remplaçables par l'environnement (proxy d'entreprise, tests de bout en bout). */
function envEndpoints(env: Record<string, string | undefined> = process.env): SourceEndpoints {
  return {
    franceTravail:
      env.FRANCE_TRAVAIL_TOKEN_URL && env.FRANCE_TRAVAIL_API_URL ? { tokenUrl: env.FRANCE_TRAVAIL_TOKEN_URL, apiUrl: env.FRANCE_TRAVAIL_API_URL } : undefined,
    adzuna: env.ADZUNA_API_URL || undefined,
  };
}

function endpointsOf(deps: SourcesDeps): SourceEndpoints {
  return deps.endpoints ?? envEndpoints();
}
const context = (userId: string, key: string) => `${userId}:${key}`;

function message(err: unknown): string {
  return err instanceof SourceError ? err.message : "Erreur inattendue de la source";
}

/** Sources de l'utilisateur, sans aucun secret. */
export async function listSources(db: Db, userId: string) {
  const rows = await db.select().from(jobSources).where(eq(jobSources.userId, userId)).orderBy(jobSources.createdAt);
  return rows.map(({ secret, ...r }) => ({ ...r, hasSecret: Boolean(secret) }));
}

async function upsertSource(db: Db, userId: string, s: { kind: SourceKind; key: string; label: string; config: Record<string, unknown>; secret: Record<string, string> | null }): Promise<string> {
  const secret = s.secret ? encryptSecret(s.secret, context(userId, s.key)) : null;
  const [row] = await db
    .insert(jobSources)
    .values({ userId, kind: s.kind, key: s.key, label: s.label, config: s.config, secret, state: "active" })
    .onConflictDoUpdate({
      target: [jobSources.userId, jobSources.key],
      set: { label: s.label, config: s.config, secret, state: "active", lastError: null, updatedAt: new Date() },
    })
    .returning({ id: jobSources.id });
  return row!.id;
}

function secretOf(userId: string, source: JobSource): Record<string, string> {
  if (!source.secret) throw new SourceError("Identifiants manquants : reconnecte la source", "auth");
  return decryptSecret(source.secret, context(userId, source.key));
}

/** Connecteur de recherche d'une source (France Travail, Adzuna, page carrières). */
export function searchConnector(deps: SourcesDeps, userId: string, source: JobSource): SearchConnector | null {
  const ep = endpointsOf(deps);
  if (source.kind === "france_travail") {
    const s = secretOf(userId, source);
    return franceTravailConnector({ clientId: s.clientId!, clientSecret: s.clientSecret! }, ep.franceTravail ?? FRANCE_TRAVAIL);
  }
  if (source.kind === "adzuna") {
    const s = secretOf(userId, source);
    return adzunaConnector({ appId: s.appId!, appKey: s.appKey! }, ep.adzuna ?? ADZUNA.apiUrl);
  }
  if (source.kind === "career_page") {
    return careerPageConnector(source.config.page as CareerPage, (source.config.company as string | null) ?? null, ep.careerPages ?? {});
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Connexion des sources : chaque connexion est testée avant d'être enregistrée.

export async function connectFranceTravail(deps: SourcesDeps, userId: string, creds: { clientId: string; clientSecret: string }): Promise<ConnectResult> {
  const clientId = creds.clientId.trim();
  const clientSecret = creds.clientSecret.trim();
  if (!clientId || !clientSecret) return { ok: false, error: "Renseigne l'identifiant client et la clé secrète de ton application francetravail.io." };
  try {
    await franceTravailConnector({ clientId, clientSecret }, endpointsOf(deps).franceTravail ?? FRANCE_TRAVAIL).test();
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  return { ok: true, sourceId: await upsertSource(deps.db, userId, { kind: "france_travail", key: "france_travail", label: "France Travail", config: {}, secret: { clientId, clientSecret } }) };
}

export async function connectAdzuna(deps: SourcesDeps, userId: string, creds: { appId: string; appKey: string }): Promise<ConnectResult> {
  const appId = creds.appId.trim();
  const appKey = creds.appKey.trim();
  if (!appId || !appKey) return { ok: false, error: "Renseigne l'app_id et l'app_key de ton compte développeur Adzuna." };
  try {
    await adzunaConnector({ appId, appKey }, endpointsOf(deps).adzuna ?? ADZUNA.apiUrl).test();
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  return { ok: true, sourceId: await upsertSource(deps.db, userId, { kind: "adzuna", key: "adzuna", label: "Adzuna", config: {}, secret: { appId, appKey } }) };
}

export async function connectCareerPage(deps: SourcesDeps, userId: string, input: { url: string; company: string }): Promise<ConnectResult> {
  const page = detectCareerPage(input.url);
  if (!page) {
    return { ok: false, error: `Page carrières non reconnue. Fournisseurs pris en charge : ${Object.values(CAREER_PROVIDERS).join(", ")} (par exemple https://jobs.lever.co/entreprise).` };
  }
  const company = input.company.trim() || null;
  try {
    await careerPageConnector(page, company, endpointsOf(deps).careerPages ?? {}).test();
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  const label = `${company ?? page.token} · ${CAREER_PROVIDERS[page.provider]}`;
  return {
    ok: true,
    sourceId: await upsertSource(deps.db, userId, { kind: "career_page", key: `${page.provider}:${page.token}`, label, config: { page, company, url: careerPageUrl(page) }, secret: null }),
  };
}

export type EmailSettingsInput = { host: string; port: number; secure: boolean; user: string; password: string; folder: string; autoFetch: boolean };

export async function connectEmailAlerts(deps: SourcesDeps, userId: string, input: EmailSettingsInput): Promise<ConnectResult> {
  const settings: ImapSettings = { host: input.host.trim().toLowerCase(), port: input.port, secure: input.secure, user: input.user.trim(), folder: input.folder.trim() || "INBOX" };
  if (!settings.host || !settings.user || !input.password) return { ok: false, error: "Renseigne le serveur IMAP, l'adresse et le mot de passe d'application." };
  try {
    await testMailbox(settings, input.password, deps.imap);
  } catch (err) {
    return { ok: false, error: message(err) };
  }
  return {
    ok: true,
    sourceId: await upsertSource(deps.db, userId, {
      kind: "email_alerts",
      key: "email_alerts",
      label: `Alertes e-mail · ${settings.user}`,
      config: { ...settings, autoFetch: input.autoFetch },
      secret: { password: input.password },
    }),
  };
}

export async function removeSource(db: Db, userId: string, sourceId: string): Promise<boolean> {
  if (!UUID.test(sourceId)) return false;
  const rows = await db.delete(jobSources).where(and(eq(jobSources.id, sourceId), eq(jobSources.userId, userId))).returning({ id: jobSources.id });
  return rows.length === 1;
}

export async function setSourceActive(db: Db, userId: string, sourceId: string, active: boolean): Promise<boolean> {
  if (!UUID.test(sourceId)) return false;
  const rows = await db
    .update(jobSources)
    .set({ state: active ? "active" : "paused", updatedAt: new Date() })
    .where(and(eq(jobSources.id, sourceId), eq(jobSources.userId, userId)))
    .returning({ id: jobSources.id });
  return rows.length === 1;
}

// ---------------------------------------------------------------------------------------------
// Recherche combinée

const MAX_TEXT = 20_000;

function store(o: IncomingOffer): StoredOffer {
  return { ...o, relatedUrls: o.relatedUrls ?? [], publishedAt: o.publishedAt?.toISOString() ?? null, text: o.text.slice(0, MAX_TEXT) };
}

function restore(o: StoredOffer): IncomingOffer {
  return { ...o, publishedAt: o.publishedAt ? new Date(o.publishedAt) : null };
}

export type MergedOffer = { offer: IncomingOffer; boards: string[]; others: IncomingOffer[] };

/**
 * Fusionne les offres vues sur plusieurs sources (URL, URL du partenaire, intitulé + entreprise + ville).
 * L'offre retenue est celle au texte complet ; les autres sont gardées pour noter où l'offre a aussi été vue.
 */
export function mergeResults(offers: IncomingOffer[]): MergedOffer[] {
  const groups: { members: IncomingOffer[]; keys: Set<string> }[] = [];
  for (const o of offers) {
    const keys = new Set<string>(
      [o.url, ...(o.relatedUrls ?? [])].map((u) => (u ? canonicalUrl(u) : null)).filter((k): k is string => Boolean(k)),
    );
    const dk = dedupKey(o.title, o.company, o.location);
    if (dk) keys.add(`k:${dk}`);
    const group = groups.find((g) => [...keys].some((k) => g.keys.has(k)));
    if (!group) groups.push({ members: [o], keys });
    else {
      for (const k of keys) group.keys.add(k);
      group.members.push(o);
    }
  }
  return groups
    .map(({ members }) => {
      const offer = members.find((m) => m.complete) ?? members[0]!;
      const others = members.filter((m) => m !== offer);
      // Jobboard de l'offre retenue en tête, puis les autres dans l'ordre alphabétique : affichage stable.
      const boards = [offer.board, ...[...new Set(others.map((m) => m.board))].filter((b) => b !== offer.board).sort()];
      return { offer: { ...offer, relatedUrls: [...(offer.relatedUrls ?? []), ...others.map((m) => m.url).filter((u): u is string => Boolean(u))] }, boards, others };
    })
    .sort((a, b) => (b.offer.publishedAt?.getTime() ?? 0) - (a.offer.publishedAt?.getTime() ?? 0));
}

/** Note les autres sources où l'offre importée a aussi été vue (doublons rattachés). */
async function ingestOthers(deps: SourcesDeps, userId: string, others: IncomingOffer[], now: Date) {
  for (const o of others) await ingestOffer(deps, userId, o, now).catch(() => null);
}

/** Offre déjà connue de l'utilisateur (même identifiant sur la source, même URL, ou même intitulé + entreprise + ville). */
async function knownOffers(db: Db, userId: string, items: { offer: IncomingOffer }[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!items.length) return out;
  const externalIds = items.map((i) => i.offer.externalId).filter((x): x is string => Boolean(x));
  const sightings = externalIds.length
    ? await db
        .select({ offerId: offerSightings.offerId, board: offerSightings.board, externalId: offerSightings.externalId })
        .from(offerSightings)
        .where(and(eq(offerSightings.userId, userId), inArray(offerSightings.externalId, externalIds)))
    : [];
  const urls = items.flatMap((i) => [i.offer.url, ...(i.offer.relatedUrls ?? [])].map((u) => (u ? canonicalUrl(u) : null)).filter((u): u is string => Boolean(u)));
  const keys = items.map((i) => dedupKey(i.offer.title, i.offer.company, i.offer.location)).filter((k): k is string => Boolean(k));
  const offers =
    urls.length || keys.length
      ? await db
          .select({ id: jobOffers.id, canonicalUrl: jobOffers.canonicalUrl, dedupKey: jobOffers.dedupKey })
          .from(jobOffers)
          .where(and(eq(jobOffers.userId, userId), or(urls.length ? inArray(jobOffers.canonicalUrl, urls) : sql`false`, keys.length ? inArray(jobOffers.dedupKey, keys) : sql`false`)))
      : [];
  items.forEach((item, i) => {
    const o = item.offer;
    const seen = sightings.find((s) => s.board === o.board && s.externalId === o.externalId);
    const itemUrls = [o.url, ...(o.relatedUrls ?? [])].map((u) => (u ? canonicalUrl(u) : null));
    const key = dedupKey(o.title, o.company, o.location);
    const match = seen?.offerId ?? offers.find((r) => (r.canonicalUrl && itemUrls.includes(r.canonicalUrl)) || (key && r.dedupKey === key))?.id;
    if (match) out.set(i, match);
  });
  return out;
}

/** Sources interrogeables (actives, hors alertes e-mail) parmi celles demandées, ou toutes. */
async function searchableSources(db: Db, userId: string, sourceIds: string[]): Promise<JobSource[]> {
  const rows = await db
    .select()
    .from(jobSources)
    .where(and(eq(jobSources.userId, userId), eq(jobSources.state, "active"), inArray(jobSources.kind, ["france_travail", "adzuna", "career_page"])));
  const wanted = sourceIds.filter((id) => UUID.test(id));
  return wanted.length ? rows.filter((r) => wanted.includes(r.id)) : rows;
}

export type SearchRunResult = { runId: string; items: SearchResultItem[]; errors: string[]; sources: number };

async function searchAll(deps: SourcesDeps, userId: string, sources: JobSource[], query: SearchQuery) {
  const errors: string[] = [];
  const outcomes = await Promise.all(
    sources.map(async (s) => {
      try {
        const connector = searchConnector(deps, userId, s);
        if (!connector) return [];
        const res = await connector.search(query);
        await deps.db.update(jobSources).set({ lastSyncAt: new Date(), lastError: null, state: "active" }).where(eq(jobSources.id, s.id));
        return res.offers;
      } catch (err) {
        const msg = `${s.label} : ${message(err)}`;
        errors.push(msg);
        await deps.db.update(jobSources).set({ lastError: message(err) }).where(eq(jobSources.id, s.id));
        return [];
      }
    }),
  );
  return { offers: outcomes.flat(), errors };
}

/** Recherche ponctuelle sur toutes les sources : résultats fusionnés, déjà connus signalés, conservés pour import. */
export async function runCombinedSearch(deps: SourcesDeps, userId: string, query: SearchQuery, sourceIds: string[] = []): Promise<SearchRunResult> {
  const sources = await searchableSources(deps.db, userId, sourceIds);
  const [run] = await deps.db.insert(syncRuns).values({ userId, trigger: "search", query: { ...query } }).returning({ id: syncRuns.id });
  const { offers, errors } = await searchAll(deps, userId, sources, query);
  const merged = mergeResults(offers);
  const known = await knownOffers(deps.db, userId, merged);
  const items: SearchResultItem[] = merged.map((m, i) => ({ offer: store(m.offer), boards: m.boards, existingOfferId: known.get(i) ?? null, others: m.others.map(store) }));
  await deps.db
    .update(syncRuns)
    .set({ status: errors.length ? (items.length ? "partial" : "failed") : "ok", finishedAt: new Date(), fetched: offers.length, errors, results: items })
    .where(eq(syncRuns.id, run!.id));
  return { runId: run!.id, items, errors, sources: sources.length };
}

export async function getSearchRun(db: Db, userId: string, runId: string): Promise<SyncRun | null> {
  if (!UUID.test(runId)) return null;
  const [row] = await db.select().from(syncRuns).where(and(eq(syncRuns.id, runId), eq(syncRuns.userId, userId), eq(syncRuns.trigger, "search")));
  return row ?? null;
}

export type ImportSummary = { created: number; duplicates: number; incomplete: number; skipped: number };

function tally(summary: ImportSummary, outcome: IngestOutcome) {
  if (outcome.kind === "created") {
    summary.created++;
    if (!outcome.complete) summary.incomplete++;
  } else if (outcome.kind === "skipped") summary.skipped++;
  else summary.duplicates++;
}

/** Importe les résultats choisis d'une recherche ponctuelle (indices dans la liste fusionnée). */
export async function importSearchResults(deps: SourcesDeps, userId: string, runId: string, indices: number[]): Promise<ImportSummary | null> {
  const run = await getSearchRun(deps.db, userId, runId);
  if (!run?.results) return null;
  const summary: ImportSummary = { created: 0, duplicates: 0, incomplete: 0, skipped: 0 };
  const results = [...run.results];
  for (const i of [...new Set(indices)].filter((i) => Number.isInteger(i) && i >= 0 && i < results.length)) {
    const outcome = await ingestOffer(deps, userId, restore(results[i]!.offer));
    tally(summary, outcome);
    await ingestOthers(deps, userId, (results[i]!.others ?? []).map(restore), new Date());
    if (outcome.kind !== "skipped") results[i] = { ...results[i]!, existingOfferId: outcome.offerId };
  }
  await deps.db
    .update(syncRuns)
    .set({ results, created: sql`${syncRuns.created} + ${summary.created}`, duplicates: sql`${syncRuns.duplicates} + ${summary.duplicates}` })
    .where(eq(syncRuns.id, run.id));
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Recherches enregistrées

export type SavedSearchInput = {
  name: string;
  keywords: string;
  location: string | null;
  radiusKm: number | null;
  contracts: string[];
  publishedWithinDays: number;
  sourceIds: string[];
  intervalHours: number;
  maxPerRun: number;
};

export async function createSavedSearch(db: Db, userId: string, input: SavedSearchInput): Promise<string> {
  const [row] = await db.insert(savedSearches).values({ userId, ...input }).returning({ id: savedSearches.id });
  return row!.id;
}

export async function listSavedSearches(db: Db, userId: string) {
  const searches = await db.select().from(savedSearches).where(eq(savedSearches.userId, userId)).orderBy(desc(savedSearches.createdAt));
  if (!searches.length) return [];
  const runs = await db
    .select()
    .from(syncRuns)
    .where(and(eq(syncRuns.userId, userId), inArray(syncRuns.savedSearchId, searches.map((s) => s.id))))
    .orderBy(desc(syncRuns.startedAt))
    .limit(200);
  return searches.map((s) => ({ ...s, lastRun: runs.find((r) => r.savedSearchId === s.id) ?? null }));
}

export async function setSavedSearchActive(db: Db, userId: string, id: string, active: boolean): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await db.update(savedSearches).set({ active }).where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId))).returning({ id: savedSearches.id });
  return rows.length === 1;
}

export async function deleteSavedSearch(db: Db, userId: string, id: string): Promise<boolean> {
  if (!UUID.test(id)) return false;
  const rows = await db.delete(savedSearches).where(and(eq(savedSearches.id, id), eq(savedSearches.userId, userId))).returning({ id: savedSearches.id });
  return rows.length === 1;
}

export function queryOf(s: SavedSearch, limit = 150): SearchQuery {
  return { keywords: s.keywords, location: s.location, radiusKm: s.radiusKm, contracts: s.contracts, publishedWithinDays: s.publishedWithinDays, limit };
}

/**
 * Exécution d'une recherche enregistrée (worker) : les offres nouvelles, des plus récentes aux plus anciennes,
 * sont importées dans la limite de `maxPerRun` (chaque offre complète part en analyse : quotas IA).
 */
export async function runSavedSearch(deps: SourcesDeps, userId: string, searchId: string, now = new Date()): Promise<SyncRun | null> {
  if (!UUID.test(searchId)) return null;
  const [search] = await deps.db.select().from(savedSearches).where(and(eq(savedSearches.id, searchId), eq(savedSearches.userId, userId)));
  if (!search) return null;
  const [run] = await deps.db.insert(syncRuns).values({ userId, savedSearchId: search.id, trigger: "schedule", query: { ...queryOf(search) } }).returning({ id: syncRuns.id });
  const sources = await searchableSources(deps.db, userId, search.sourceIds);
  const { offers, errors } = await searchAll(deps, userId, sources, queryOf(search));
  const merged = mergeResults(offers);
  const known = await knownOffers(deps.db, userId, merged);
  const summary: ImportSummary = { created: 0, duplicates: 0, incomplete: 0, skipped: 0 };
  let deferred = 0;
  for (const [i, m] of merged.entries()) {
    try {
      if (known.has(i)) {
        // Déjà connue : on note seulement où elle a été revue.
        await ingestOffer(deps, userId, m.offer, now);
        await ingestOthers(deps, userId, m.others, now);
        summary.duplicates++;
      } else if (summary.created >= search.maxPerRun) {
        deferred++;
      } else {
        tally(summary, await ingestOffer(deps, userId, m.offer, now));
        await ingestOthers(deps, userId, m.others, now);
      }
    } catch {
      summary.skipped++;
    }
  }
  // Les échecs de sources décident du statut ; le report au passage suivant n'est qu'une information.
  const notes = deferred ? [`${deferred} offre${deferred > 1 ? "s" : ""} au-delà du plafond de ${search.maxPerRun} par exécution : importée${deferred > 1 ? "s" : ""} au prochain passage.`] : [];
  const [done] = await deps.db
    .update(syncRuns)
    .set({
      status: !sources.length || errors.length >= sources.length ? "failed" : errors.length ? "partial" : "ok",
      finishedAt: new Date(),
      fetched: offers.length,
      created: summary.created,
      duplicates: summary.duplicates,
      errors: sources.length ? [...errors, ...notes] : ["Aucune source interrogeable : connecte France Travail, Adzuna ou une page carrières."],
    })
    .where(eq(syncRuns.id, run!.id))
    .returning();
  await deps.db.update(savedSearches).set({ lastRunAt: now }).where(eq(savedSearches.id, search.id));
  return done ?? null;
}

// ---------------------------------------------------------------------------------------------
// Alertes e-mail

const MAX_FETCH_PER_SYNC = 10;

/**
 * Lit les nouvelles alertes de la boîte dédiée, en extrait les offres et les ajoute (à compléter).
 * Si le réglage le permet, le texte est récupéré pour les sites qui l'autorisent (jamais LinkedIn ni Indeed).
 */
export async function syncEmailAlerts(deps: SourcesDeps, userId: string, sourceId: string): Promise<SyncRun | null> {
  if (!UUID.test(sourceId)) return null;
  const [source] = await deps.db.select().from(jobSources).where(and(eq(jobSources.id, sourceId), eq(jobSources.userId, userId), eq(jobSources.kind, "email_alerts")));
  if (!source) return null;
  const [run] = await deps.db.insert(syncRuns).values({ userId, sourceId, trigger: "schedule" }).returning({ id: syncRuns.id });
  const config = source.config as unknown as ImapSettings & { autoFetch?: boolean };
  const errors: string[] = [];
  const summary: ImportSummary = { created: 0, duplicates: 0, incomplete: 0, skipped: 0 };
  let fetched = 0;
  try {
    const { password } = secretOf(userId, source);
    const read = await readNewMessages(config, password!, (source.cursor as ImapCursor | null) ?? null, deps.imap);
    const unknown = new Map<string, number>();
    let fetches = 0;
    for (const msg of read.messages) {
      const board = boardForSender(msg.fromAddress);
      if (!board) {
        const domain = msg.fromAddress?.split("@").pop() ?? "expéditeur inconnu";
        unknown.set(domain, (unknown.get(domain) ?? 0) + 1);
        continue;
      }
      const offers = await extractOffers(board, msg, deps.resolve ?? ((u) => resolveRedirect(u, deps.fetchOptions)));
      if (!offers.length) unknown.set(`${board.label} (aucune offre reconnue)`, (unknown.get(`${board.label} (aucune offre reconnue)`) ?? 0) + 1);
      fetched += offers.length;
      for (const o of offers) {
        const outcome = await ingestOffer(deps, userId, o);
        tally(summary, outcome);
        if (outcome.kind === "created" && !outcome.complete && config.autoFetch !== false && !board.noFetch && fetches < MAX_FETCH_PER_SYNC) {
          fetches++;
          const completed = await fetchOfferText(deps, userId, outcome.offerId).catch(() => ({ ok: false as const }));
          if (completed.ok) summary.incomplete--;
        }
      }
    }
    for (const [what, n] of unknown) errors.push(`Non reconnu : ${what} (${n} e-mail${n > 1 ? "s" : ""})`);
    await deps.db.update(jobSources).set({ cursor: read.cursor, lastSyncAt: new Date(), lastError: null, state: "active" }).where(eq(jobSources.id, source.id));
  } catch (err) {
    errors.push(message(err));
    await deps.db.update(jobSources).set({ lastError: message(err), state: err instanceof SourceError && err.kind === "auth" ? "error" : source.state }).where(eq(jobSources.id, source.id));
  }
  const [done] = await deps.db
    .update(syncRuns)
    .set({ status: errors.some((e) => !e.startsWith("Non reconnu")) ? "failed" : "ok", finishedAt: new Date(), fetched, created: summary.created, duplicates: summary.duplicates, errors })
    .where(eq(syncRuns.id, run!.id))
    .returning();
  return done ?? null;
}

// ---------------------------------------------------------------------------------------------
// Planification

/** Travail dû : boîtes d'alertes actives (toutes les 15 min) et recherches enregistrées arrivées à échéance. */
export async function dueWork(db: Db, now = new Date()) {
  const mailboxes = await db
    .select({ sourceId: jobSources.id, userId: jobSources.userId })
    .from(jobSources)
    .where(and(eq(jobSources.kind, "email_alerts"), eq(jobSources.state, "active")));
  const searches = await db
    .select({ searchId: savedSearches.id, userId: savedSearches.userId })
    .from(savedSearches)
    .where(
      and(
        eq(savedSearches.active, true),
        or(isNull(savedSearches.lastRunAt), lt(savedSearches.lastRunAt, sql`${now.toISOString()}::timestamptz - make_interval(hours => ${savedSearches.intervalHours})`)),
      ),
    );
  return { mailboxes, searches };
}

/** Conservation limitée : les recherches ponctuelles (et leurs résultats) de plus de `days` jours sont effacées. */
export async function purgeSearchRuns(db: Db, days = 30, now = new Date()): Promise<number> {
  const rows = await db
    .delete(syncRuns)
    .where(and(eq(syncRuns.trigger, "search"), lt(syncRuns.startedAt, new Date(now.getTime() - days * 24 * 60 * 60 * 1000))))
    .returning({ id: syncRuns.id });
  return rows.length;
}

export async function recentRuns(db: Db, userId: string, limit = 20) {
  return db.select().from(syncRuns).where(and(eq(syncRuns.userId, userId), inArray(syncRuns.trigger, ["schedule", "manual"]))).orderBy(desc(syncRuns.startedAt)).limit(limit);
}

/** Où une offre a été vue (fiche offre). */
export async function sightingsOf(db: Db, userId: string, offerId: string) {
  return db
    .select()
    .from(offerSightings)
    .where(and(eq(offerSightings.userId, userId), eq(offerSightings.offerId, offerId)))
    .orderBy(offerSightings.firstSeenAt);
}

export { BOARDS };
