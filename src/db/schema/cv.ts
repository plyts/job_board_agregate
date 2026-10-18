import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { CvContent } from "@/modules/cv/content";
import { users } from "./identity";
import { jobOffers } from "./offers";
import { llmCalls } from "./platform";
import { profileVersions } from "./profile";

export const cvVersionStatus = pgEnum("cv_version_status", ["draft", "saved", "finalized"]);
export const cvSuggestStatus = pgEnum("cv_suggest_status", ["none", "queued", "running", "done", "failed"]);
export const cvSuggestionKind = pgEnum("cv_suggestion_kind", ["rephrase", "summary", "reorder_items", "include"]);
export const cvSuggestionState = pgEnum("cv_suggestion_state", ["pending", "accepted", "rejected", "edited", "blocked"]);

/**
 * Versions d'un CV personnalisé pour une offre. Un brouillon modifiable par offre ; les versions
 * enregistrées et finalisées sont immuables (trigger SQL).
 */
export const cvVersions = pgTable(
  "cv_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    baseProfileVersionId: uuid("base_profile_version_id")
      .notNull()
      .references(() => profileVersions.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: cvVersionStatus("status").notNull().default("draft"),
    content: jsonb("content").$type<CvContent>().notNull(),
    /** Incrémenté à chaque modification du brouillon : refuse une sauvegarde faite sur un état périmé. */
    revision: integer("revision").notNull().default(0),
    suggestStatus: cvSuggestStatus("suggest_status").notNull().default("none"),
    suggestReason: text("suggest_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }),
  },
  (t) => [
    unique("cv_versions_offer_version_unique").on(t.offerId, t.version),
    uniqueIndex("cv_versions_one_draft").on(t.offerId).where(sql`${t.status} = 'draft'`),
    index("cv_versions_user_offer_idx").on(t.userId, t.offerId),
  ],
);

export const cvSuggestions = pgTable(
  "cv_suggestions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    cvVersionId: uuid("cv_version_id")
      .notNull()
      .references(() => cvVersions.id, { onDelete: "cascade" }),
    /** Rang dans le lot : le modèle classe ses suggestions de la plus utile à la moins utile. */
    position: integer("position").notNull().default(0),
    kind: cvSuggestionKind("kind").notNull(),
    targetId: text("target_id"),
    text: text("text"),
    order: jsonb("order").$type<string[]>(),
    sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
    rationale: text("rationale").notNull(),
    covers: text("covers"),
    state: cvSuggestionState("state").notNull().default("pending"),
    blockReason: text("block_reason"),
    /** État avant application, pour pouvoir annuler. */
    before: jsonb("before").$type<unknown>(),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    index("cv_suggestions_version_idx").on(t.cvVersionId, t.createdAt),
    // Une suggestion sans élément du profil pour l'appuyer n'est jamais enregistrée.
    check("cv_suggestions_sourced", sql`jsonb_array_length(${t.sourceIds}) > 0`),
  ],
);
