import { index, integer, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("llm_calls_user_created_idx").on(t.userId, t.createdAt), index("llm_calls_provider_created_idx").on(t.provider, t.createdAt)],
);
