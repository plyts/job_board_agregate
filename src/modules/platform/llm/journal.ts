import { createHash } from "node:crypto";
import { consentedProviders, NO_CONSENT_NEEDED } from "@/modules/privacy/consent";
import { redactPii, sanitizeOutput, totalCount, type PiiCounts } from "@/modules/privacy/pii";
import { and, avg, count, eq, gte, ne, sql, sum } from "drizzle-orm";
import type { Db } from "@/db/client";
import { llmCalls } from "@/db/schema";
import { LlmRouter, type RoutedProvider } from "./router";
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

/** Appels réellement envoyés à un fournisseur aujourd'hui (tous utilisateurs : la limite est celle de la clé). */
export async function providerCallsToday(db: Db, provider: string, now = new Date()): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(llmCalls)
    .where(and(eq(llmCalls.provider, provider), gte(llmCalls.createdAt, startOfDay(now)), ne(llmCalls.status, "budget_exceeded")));
  return row?.n ?? 0;
}

export type ProviderUsage = { provider: string; calls: number; ok: number; failed: number; avgLatencyMs: number | null; costUsd: number };

/** Consommation du jour par fournisseur, tous utilisateurs (les quotas gratuits sont ceux de la clé). */
export async function providerUsageToday(db: Db, now = new Date()): Promise<ProviderUsage[]> {
  const rows = await db
    .select({
      provider: llmCalls.provider,
      calls: count(),
      ok: sql<number>`count(*) filter (where ${llmCalls.status} = 'ok')`.mapWith(Number),
      avgLatencyMs: avg(sql`case when ${llmCalls.status} = 'ok' then ${llmCalls.latencyMs} end`),
      costUsd: sum(llmCalls.costUsd),
    })
    .from(llmCalls)
    .where(and(gte(llmCalls.createdAt, startOfDay(now)), ne(llmCalls.status, "budget_exceeded")))
    .groupBy(llmCalls.provider);
  return rows.map((r) => ({
    provider: r.provider,
    calls: r.calls,
    ok: r.ok,
    failed: r.calls - r.ok,
    avgLatencyMs: r.avgLatencyMs === null ? null : Math.round(Number(r.avgLatencyMs)),
    costUsd: Number(r.costUsd ?? 0),
  }));
}

export function inputHash(req: StructuredRequest<unknown>): string {
  return createHash("sha256").update(req.system).update("\u0000").update(req.user).digest("hex");
}

export type JournaledResult<T> = LlmResult<T> & {
  costUsd: number;
  callId: string;
  provider: string;
  /** Données personnelles : masquées avant l'envoi et retirées de la réponse (décomptes par catégorie). */
  privacy: { masked: PiiCounts; inOutput: PiiCounts } | null;
};

const NO_LIMIT = { allowsPersonalData: true, requestsPerMinute: null, requestsPerDay: null };

/**
 * Appelle le modèle sous budget journalier et journalise chaque tentative (succès ou échec).
 * Avec un routeur, les fournisseurs sont essayés dans l'ordre : un fournisseur saturé, en échec ou
 * non autorisé pour des données personnelles laisse la place au suivant.
 * Un budget dépassé ou des quotas épuisés lèvent une erreur reprenable : la tâche repartira plus tard.
 */
export async function generateJournaled<T>(
  db: Db,
  llm: LlmClient | LlmRouter,
  userId: string,
  req: StructuredRequest<T>,
  options: { budgetUsd?: number; now?: Date } = {},
): Promise<JournaledResult<T>> {
  const budget = options.budgetUsd ?? dailyBudgetUsd();
  const router = llm instanceof LlmRouter ? llm : null;
  let candidates: RoutedProvider[] = router ? router.eligible(req.dataClass) : [{ client: llm as LlmClient, policy: NO_LIMIT }];
  // Garde de confidentialité, appliquée à chaque appel portant des données personnelles, quel que soit l'appelant :
  // avant, masquage local (identité, coordonnées, adresse, naissance, NIR, IBAN, liens, données sensibles) ;
  // seuls les fournisseurs pour lesquels l'utilisateur a donné son consentement (ou un modèle local) sont éligibles.
  let request = req;
  let masked: PiiCounts = {};
  const personal = req.dataClass === "personal";
  if (personal) {
    const redacted = redactPii(req.user, { names: req.privacy?.names });
    request = { ...req, user: redacted.text };
    masked = redacted.counts;
    const consented = await consentedProviders(db, userId);
    candidates = candidates.filter((c) => NO_CONSENT_NEEDED.has(c.client.provider) || consented.has(c.client.provider));
  }
  const base = {
    userId,
    purpose: req.purpose,
    promptVersion: req.promptVersion,
    schemaVersion: req.schemaVersion,
    inputHash: inputHash(request as StructuredRequest<unknown>),
    piiMasked: totalCount(masked),
  };

  if ((await spentTodayUsd(db, userId, options.now)) >= budget) {
    const first = candidates[0]?.client;
    await db.insert(llmCalls).values({ ...base, provider: first?.provider ?? "none", model: first?.model ?? "none", status: "budget_exceeded", errorCode: "budget_exceeded" });
    throw new LlmError("budget_exceeded", "Budget IA du jour atteint", true);
  }
  if (candidates.length === 0) {
    throw new LlmError(
      "no_provider",
      personal ? "Aucun fournisseur IA n'est à la fois autorisé et consenti pour recevoir tes données personnelles" : "Aucun fournisseur IA configuré",
      false,
    );
  }

  let lastError: LlmError | null = null;
  let anyRetryable = false;
  let skippedForQuota = 0;
  let skippedForRate = 0;
  for (const candidate of candidates) {
    const { client, policy } = candidate;
    if (policy.requestsPerDay !== null && (await providerCallsToday(db, client.provider, options.now)) >= policy.requestsPerDay) {
      skippedForQuota++;
      continue;
    }
    if (router && !router.tryAcquire(candidate)) {
      skippedForRate++;
      continue;
    }
    try {
      const result = await client.generateStructured(request);
      // Après : toute donnée personnelle présente dans la réponse (reprise ou inventée) est retirée.
      const cleaned = personal ? sanitizeOutput(result.output, { names: req.privacy?.names }) : null;
      const cost = result.reportedCostUsd ?? client.estimateCostUsd(result.model, result.usage);
      const [row] = await db
        .insert(llmCalls)
        .values({
          ...base,
          provider: client.provider,
          model: result.model,
          status: "ok",
          ...result.usage,
          costUsd: cost,
          latencyMs: result.latencyMs,
          piiInOutput: cleaned ? totalCount(cleaned.counts) : 0,
        })
        .returning({ id: llmCalls.id });
      return {
        ...result,
        output: cleaned ? cleaned.value : result.output,
        costUsd: cost,
        callId: row!.id,
        provider: client.provider,
        privacy: cleaned ? { masked, inOutput: cleaned.counts } : null,
      };
    } catch (err) {
      const e = err instanceof LlmError ? err : new LlmError("api_error", err instanceof Error ? err.message : "Erreur inconnue", true);
      const usage = e.usage ?? ZERO_USAGE;
      await db.insert(llmCalls).values({
        ...base,
        provider: client.provider,
        model: client.model,
        status: e.code,
        errorCode: e.code,
        ...usage,
        costUsd: client.estimateCostUsd(client.model, usage),
        latencyMs: e.latencyMs ?? 0,
      });
      if (e.code === "rate_limited") router?.markRateLimited(client.provider, e.retryAfterMs);
      lastError = e;
      anyRetryable ||= e.retryable;
    }
  }

  if (!lastError) {
    // Aucun appel n'a pu partir : quotas du jour épuisés partout, ou limites par minute atteintes.
    if (skippedForQuota > 0 && skippedForRate === 0) throw new LlmError("quota_exhausted", "Quotas gratuits du jour épuisés", true);
    throw new LlmError("rate_limited", "Limites de débit atteintes pour tous les fournisseurs", true);
  }
  if (candidates.length === 1) throw lastError;
  throw new LlmError(lastError.code, `Tous les fournisseurs ont échoué (dernier : ${lastError.message})`, anyRetryable, lastError.usage, lastError.latencyMs);
}
