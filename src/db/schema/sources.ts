import { sql } from "drizzle-orm";
import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { jobOffers, offerSource } from "./offers";

export const sourceKind = pgEnum("source_kind", ["france_travail", "adzuna", "career_page", "email_alerts"]);
export const sourceState = pgEnum("source_state", ["active", "paused", "error"]);
export const syncTrigger = pgEnum("sync_trigger", ["schedule", "manual", "search"]);
export const syncStatus = pgEnum("sync_status", ["running", "ok", "partial", "failed"]);

/**
 * Source connectée par l'utilisateur : API officielle, page carrières d'une entreprise ou boîte d'alertes e-mail.
 * Les identifiants (clés d'API, mot de passe d'application IMAP) sont chiffrés (AES-256-GCM) dans `secret` ;
 * aucun mot de passe de compte de jobboard n'est jamais demandé ni stocké.
 */
export const jobSources = pgTable(
  "job_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: sourceKind("kind").notNull(),
    /** Identité de la source pour l'utilisateur : le type, ou « fournisseur:identifiant » pour une page carrières. */
    key: text("key").notNull(),
    label: text("label").notNull(),
    /** Réglages non secrets (hôte IMAP, fournisseur et identifiant de la page carrières…). */
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    secret: text("secret"),
    state: sourceState("state").notNull().default("active"),
    /** Point de reprise de la synchronisation (IMAP : UIDVALIDITY et dernier UID lu). */
    cursor: jsonb("cursor").$type<Record<string, unknown>>(),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("job_sources_user_key").on(t.userId, t.key)],
);

/** Recherche enregistrée : lancée périodiquement par le worker sur les sources choisies (toutes par défaut). */
export const savedSearches = pgTable(
  "saved_searches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    keywords: text("keywords").notNull(),
    location: text("location"),
    radiusKm: integer("radius_km"),
    /** Types de contrat (CDI, CDD, MIS, SAI, LIB, alternance…) ; vide = tous. */
    contracts: jsonb("contracts").$type<string[]>().notNull().default([]),
    publishedWithinDays: integer("published_within_days").notNull().default(7),
    /** Sources interrogées ; vide = toutes les sources interrogeables. */
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    intervalHours: integer("interval_hours").notNull().default(6),
    /** Plafond d'offres créées par exécution : chaque offre importée part en analyse (quotas IA). */
    maxPerRun: integer("max_per_run").notNull().default(20),
    active: boolean("active").notNull().default(true),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("saved_searches_user_idx").on(t.userId)],
);

/** Offre trouvée par une recherche ponctuelle, conservée telle que reçue pour être importée ensuite. */
export type StoredOffer = {
  origin: "france_travail" | "adzuna" | "career_page" | "email_alert";
  board: string;
  externalId: string | null;
  url: string | null;
  relatedUrls: string[];
  title: string;
  company: string | null;
  location: string | null;
  publishedAt: string | null;
  text: string;
  complete: boolean;
};

/** Résultat fusionné : la même annonce vue sur plusieurs sources n'apparaît qu'une fois. */
export type SearchResultItem = { offer: StoredOffer; boards: string[]; existingOfferId: string | null; others?: StoredOffer[] };

/** Exécution d'une synchronisation ou d'une recherche : compteurs, erreurs, et résultats d'une recherche ponctuelle. */
export const syncRuns = pgTable(
  "sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => jobSources.id, { onDelete: "cascade" }),
    savedSearchId: uuid("saved_search_id").references(() => savedSearches.id, { onDelete: "set null" }),
    trigger: syncTrigger("trigger").notNull(),
    status: syncStatus("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    fetched: integer("fetched").notNull().default(0),
    created: integer("created").notNull().default(0),
    duplicates: integer("duplicates").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    /** Recherche ponctuelle : critères et résultats fusionnés, importables ensuite. */
    query: jsonb("query").$type<Record<string, unknown>>(),
    results: jsonb("results").$type<SearchResultItem[]>(),
  },
  (t) => [index("sync_runs_user_started_idx").on(t.userId, t.startedAt)],
);

/** Où une offre a été vue : une ligne par source et identifiant externe (dédoublonnage multi-jobboards, « trouvée sur »). */
export const offerSightings = pgTable(
  "offer_sightings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    origin: offerSource("origin").notNull(),
    /** Jobboard d'origine : france_travail, adzuna, greenhouse, linkedin, indeed, wttj… */
    board: text("board").notNull(),
    externalId: text("external_id"),
    url: text("url"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("offer_sightings_external").on(t.userId, t.board, t.externalId).where(sql`${t.externalId} is not null`),
    index("offer_sightings_offer_idx").on(t.offerId),
  ],
);
