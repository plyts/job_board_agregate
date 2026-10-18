import { boolean, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";
import { llmCalls } from "./platform";
import { jobOffers } from "./offers";

export const requirementKind = pgEnum("requirement_kind", [
  "mission",
  "hard_skill",
  "soft_skill",
  "tech",
  "years",
  "seniority",
  "degree",
  "certification",
  "language",
  "contract",
  "location",
  "remote",
  "availability",
  "salary",
  "clearance",
]);
export const requirementImportance = pgEnum("requirement_importance", ["mandatory", "preferred", "condition"]);
export const provenance = pgEnum("provenance", ["explicit", "inferred", "uncertain"]);
export const analysisState = pgEnum("analysis_state", ["current", "superseded"]);

export const offerAnalyses = pgTable(
  "offer_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    state: analysisState("state").notNull().default("current"),
    schemaVersion: integer("schema_version").notNull(),
    promptVersion: text("prompt_version").notNull(),
    model: text("model").notNull(),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, { onDelete: "set null" }),
    /** Champs que l'annonce ne mentionne pas : jamais estimés. */
    notMentioned: jsonb("not_mentioned").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("offer_analyses_offer_idx").on(t.offerId, t.state)],
);

export const jobRequirements = pgTable(
  "job_requirements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => offerAnalyses.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    kind: requirementKind("kind").notNull(),
    importance: requirementImportance("importance").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    minYears: integer("min_years"),
    provenance: provenance("provenance").notNull(),
    quote: text("quote"),
    /** Position de la citation dans `job_offers.raw_text`, vérifiée par le serveur. */
    quoteStart: integer("quote_start"),
    quoteEnd: integer("quote_end"),
    rationale: text("rationale"),
    /** Raison d'un déclassement automatique (citation introuvable, justification absente…). */
    verificationNote: text("verification_note"),
    correctedByUser: boolean("corrected_by_user").notNull().default(false),
    removedByUser: boolean("removed_by_user").notNull().default(false),
  },
  (t) => [index("job_requirements_analysis_idx").on(t.analysisId, t.position)],
);

/** Journal des corrections : alimente le jeu d'évaluation et les métriques de qualité. */
export const requirementCorrections = pgTable("requirement_corrections", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  requirementId: uuid("requirement_id")
    .notNull()
    .references(() => jobRequirements.id, { onDelete: "cascade" }),
  before: jsonb("before").$type<Record<string, unknown>>().notNull(),
  after: jsonb("after").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
