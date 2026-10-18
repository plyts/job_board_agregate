import { sql } from "drizzle-orm";
import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

/** Journal de chaque appel au modèle : coûts, latence et erreurs, jamais le contenu. */
export const llmCalls = pgTable(
  "llm_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    /** Fournisseur appelé : anthropic, groq, openrouter, gemini, mistral, cerebras, local… */
    provider: text("provider").notNull().default("anthropic"),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    inputHash: text("input_hash").notNull(),
    status: text("status", {
      enum: ["ok", "refused", "truncated", "invalid_output", "api_error", "rate_limited", "budget_exceeded", "quota_exhausted", "no_provider"],
    }).notNull(),
    errorCode: text("error_code"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
    cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }).notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    /** Données personnelles masquées avant l'envoi et retirées de la réponse (décomptes, jamais les valeurs). */
    piiMasked: integer("pii_masked").notNull().default(0),
    piiInOutput: integer("pii_in_output").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_user_created_idx").on(t.userId, t.createdAt), index("llm_calls_provider_created_idx").on(t.provider, t.createdAt)],
);

/**
 * Consentement explicite et révocable à l'envoi de données personnelles (CV sans coordonnées) à un
 * fournisseur IA donné (RGPD art. 6 et 7, transferts hors UE). Un modèle local n'en a pas besoin.
 */
export const aiConsents = pgTable(
  "ai_consents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  // Un seul consentement actif par fournisseur ; les consentements retirés restent comme historique daté.
  (t) => [uniqueIndex("ai_consents_one_active").on(t.userId, t.provider).where(sql`${t.revokedAt} is null`)],
);
