import { sql } from "drizzle-orm";
import { index, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

export const offerSource = pgEnum("offer_source", ["url", "text", "file"]);
export const offerStatus = pgEnum("offer_status", ["queued", "analyzing", "analyzed", "failed", "qualified", "discarded"]);
export const importOutcome = pgEnum("import_outcome", ["created", "duplicate"]);

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("companies_user_name_unique").on(t.userId, t.normalizedName)],
);

export const jobOffers = pgTable(
  "job_offers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: offerSource("source").notNull(),
    /** URL telle que fournie, conservée pour retrouver l'annonce d'origine. */
    originalUrl: text("original_url"),
    canonicalUrl: text("canonical_url"),
    title: text("title").notNull(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "set null" }),
    location: text("location"),
    rawText: text("raw_text").notNull(),
    contentHash: text("content_hash").notNull(),
    sourceFileKey: text("source_file_key"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
    status: offerStatus("status").notNull().default("queued"),
    statusReason: text("status_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("job_offers_user_hash_unique").on(t.userId, t.contentHash),
    uniqueIndex("job_offers_user_canonical_url_unique").on(t.userId, t.canonicalUrl).where(sql`${t.canonicalUrl} is not null`),
    index("job_offers_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Une ligne par import tenté : source des métriques « collectées » et « doublons ». */
export const offerImports = pgTable(
  "offer_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    source: offerSource("source").notNull(),
    outcome: importOutcome("outcome").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offer_imports_user_created_idx").on(t.userId, t.createdAt)],
);

export const offerEventType = pgEnum("offer_event_type", ["qualified", "discarded"]);

/** Décisions sur une offre, datées et append-only (trigger) : base des métriques « qualifiées » et « traitées ». */
export const offerEvents = pgTable(
  "offer_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    type: offerEventType("type").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offer_events_user_time_idx").on(t.userId, t.occurredAt)],
);
