import { index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { MatchCategory, Weights } from "@/modules/matching/score";
import { analysisState, jobRequirements, offerAnalyses, requirementImportance, requirementKind } from "./analysis";
import { users } from "./identity";
import { jobOffers } from "./offers";
import { llmCalls } from "./platform";
import { profileVersions } from "./profile";

export const matchStatus = pgEnum("match_status", ["pending", "done", "failed"]);
export const matchMode = pgEnum("match_mode", ["model", "rules_only"]);
export const matchCategory = pgEnum("match_category", [
  "confirmed",
  "partial",
  "to_confirm",
  "not_demonstrated",
  "potential_incompatibility",
  "not_applicable",
]);
export const matchItemSource = pgEnum("match_item_source", ["rule", "model", "guard"]);

export type MatchEvidence = { id: string; label: string; text: string };
export type StoredFactor = { factor: string; weight: number; value: number | null; items: number; points: number; maxPoints: number };

export const matchAnalyses = pgTable(
  "match_analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    offerId: uuid("offer_id")
      .notNull()
      .references(() => jobOffers.id, { onDelete: "cascade" }),
    offerAnalysisId: uuid("offer_analysis_id")
      .notNull()
      .references(() => offerAnalyses.id, { onDelete: "cascade" }),
    profileVersionId: uuid("profile_version_id")
      .notNull()
      .references(() => profileVersions.id, { onDelete: "cascade" }),
    /** Version de CV personnalisé comparée (recontrôle), sinon le profil maître. */
    cvVersionId: uuid("cv_version_id"),
    state: analysisState("state").notNull().default("current"),
    status: matchStatus("status").notNull().default("pending"),
    statusReason: text("status_reason"),
    mode: matchMode("mode"),
    weights: jsonb("weights").$type<Weights>().notNull(),
    score: integer("score"),
    factors: jsonb("factors").$type<StoredFactor[]>().notNull().default([]),
    llmCallId: uuid("llm_call_id").references(() => llmCalls.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("match_analyses_offer_idx").on(t.offerId, t.state)],
);

export const matchItems = pgTable(
  "match_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    matchId: uuid("match_id")
      .notNull()
      .references(() => matchAnalyses.id, { onDelete: "cascade" }),
    requirementId: uuid("requirement_id")
      .notNull()
      .references(() => jobRequirements.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    /** Type et importance figés au moment du matching : une correction ultérieure ne change pas ce score. */
    kind: requirementKind("kind").notNull(),
    importance: requirementImportance("importance").notNull(),
    category: matchCategory("category").notNull().$type<MatchCategory>(),
    evidence: jsonb("evidence").$type<MatchEvidence[]>().notNull().default([]),
    rationale: text("rationale").notNull(),
    action: text("action").notNull(),
    /** rule : calcul déterministe ; model : jugement du modèle ; guard : jugement corrigé par un garde-fou. */
    source: matchItemSource("source").notNull(),
  },
  (t) => [index("match_items_match_idx").on(t.matchId, t.position)],
);
