import { createHash } from "node:crypto";
import { and, eq, gte, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { llmCalls } from "@/db/schema";
import { costUsd } from "./pricing";
import { LlmError, ZERO_USAGE, type LlmClient, type LlmResult, type StructuredRequest } from "./types";

export const DEFAULT_DAILY_BUDGET_USD = 2;

export function dailyBudgetUsd(): number {
  const raw = Number(process.env.LLM_DAILY_BUDGET_USD);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_DAILY_BUDGET_USD;
}

function startOfDay(now: Date): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

export async function spentTodayUsd(db: Db, userId: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ total: sum(llmCalls.costUsd) })
    .from(llmCalls)
    .where(and(eq(llmCalls.userId, userId), gte(llmCalls.createdAt, startOfDay(now))));
  return Number(row?.total ?? 0);
}

export function inputHash(req: StructuredRequest<unknown>): string {
  return createHash("sha256").update(req.system).update("\u0000").update(req.user).digest("hex");
}

/**
 * Appelle le modèle sous budget journalier et journalise chaque tentative (succès ou échec).
 * Un budget dépassé lève une erreur reprenable : la tâche repartira le lendemain.
 */
export async function generateJournaled<T>(
  db: Db,
  llm: LlmClient,
  userId: string,
  req: StructuredRequest<T>,
  options: { budgetUsd?: number; now?: Date } = {},
): Promise<LlmResult<T> & { costUsd: number; callId: string }> {
  const budget = options.budgetUsd ?? dailyBudgetUsd();
  const base = {
    userId,
    purpose: req.purpose,
    model: llm.model,
    promptVersion: req.promptVersion,
    schemaVersion: req.schemaVersion,
    inputHash: inputHash(req as StructuredRequest<unknown>),
  };
  if ((await spentTodayUsd(db, userId, options.now)) >= budget) {
    await db.insert(llmCalls).values({ ...base, status: "budget_exceeded", errorCode: "budget_exceeded" });
    throw new LlmError("budget_exceeded", "Budget IA du jour atteint", true);
  }
  try {
    const result = await llm.generateStructured(req);
    const cost = costUsd(result.model, result.usage);
    const [row] = await db
      .insert(llmCalls)
      .values({ ...base, model: result.model, status: "ok", ...result.usage, costUsd: cost, latencyMs: result.latencyMs })
      .returning({ id: llmCalls.id });
    return { ...result, costUsd: cost, callId: row!.id };
  } catch (err) {
    const e = err instanceof LlmError ? err : new LlmError("api_error", err instanceof Error ? err.message : "Erreur inconnue", true);
    const usage = e.usage ?? ZERO_USAGE;
    await db.insert(llmCalls).values({
      ...base,
      status: e.code,
      errorCode: e.code,
      ...usage,
      costUsd: costUsd(llm.model, usage),
      latencyMs: e.latencyMs ?? 0,
    });
    throw e;
  }
}
