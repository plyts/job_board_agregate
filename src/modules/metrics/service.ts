import { and, asc, count, countDistinct, eq, inArray, isNull, lt, notInArray, sql, sum, avg, type SQL, type AnyColumn } from "drizzle-orm";
import type { Db } from "@/db/client";
import { applicationEvents, applications, companies, cvVersions, jobOffers, llmCalls, offerAnalyses, offerEvents, offerImports } from "@/db/schema";
import { addDays } from "@/modules/applications/rules";
import { dailyBudgetUsd, spentTodayUsd } from "@/modules/platform/llm/journal";

export type Period = "day" | "week";
export type DashboardOptions = { period: Period; today: string; timeZone: string; dailyGoal: number };

const CLOSED = ["rejected", "abandoned"] as const;

/** Objectif quotidien d'offres traitées (qualifiées ou écartées), réglable par `JOBPILOT_DAILY_GOAL`. */
export function dailyGoal(): number {
  const raw = Number(process.env.JOBPILOT_DAILY_GOAL);
  return Number.isInteger(raw) && raw > 0 ? raw : 20;
}

const ratio = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 100) : null);

/**
 * Tableau de bord calculé à chaque affichage à partir de lignes datées (imports, analyses, décisions,
 * versions finalisées, événements de candidature) : aucun compteur n'est incrémenté ni stocké.
 * Les jours sont ceux du fuseau de l'utilisateur.
 */
export async function getDashboard(db: Db, userId: string, opts: DashboardOptions) {
  const from = opts.period === "day" ? opts.today : addDays(opts.today, -6);
  const to = opts.today;
  const inRange = (col: AnyColumn): SQL => sql`(${col} at time zone ${opts.timeZone})::date between ${from}::date and ${to}::date`;
  const one = async (q: Promise<{ n: number | string | null }[]>) => Number((await q)[0]?.n ?? 0);

  const [collected, fresh, analyzed, qualified, processed, cvFinalized, prepared, sent, interviews, refusals] = await Promise.all([
    one(db.select({ n: count() }).from(offerImports).where(and(eq(offerImports.userId, userId), inRange(offerImports.createdAt)))),
    one(db.select({ n: count() }).from(offerImports).where(and(eq(offerImports.userId, userId), eq(offerImports.outcome, "created"), inRange(offerImports.createdAt)))),
    one(db.select({ n: countDistinct(offerAnalyses.offerId) }).from(offerAnalyses).where(and(eq(offerAnalyses.userId, userId), inRange(offerAnalyses.createdAt)))),
    one(db.select({ n: countDistinct(offerEvents.offerId) }).from(offerEvents).where(and(eq(offerEvents.userId, userId), eq(offerEvents.type, "qualified"), inRange(offerEvents.occurredAt)))),
    one(db.select({ n: countDistinct(offerEvents.offerId) }).from(offerEvents).where(and(eq(offerEvents.userId, userId), inRange(offerEvents.occurredAt)))),
    one(
      db
        .select({ n: countDistinct(cvVersions.offerId) })
        .from(cvVersions)
        .where(and(eq(cvVersions.userId, userId), eq(cvVersions.status, "finalized"), inRange(cvVersions.finalizedAt))),
    ),
    one(
      db
        .select({ n: countDistinct(applicationEvents.applicationId) })
        .from(applicationEvents)
        .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.toStatus, "ready"), inRange(applicationEvents.occurredAt))),
    ),
    one(db.select({ n: count() }).from(applicationEvents).where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.type, "sent"), inRange(applicationEvents.occurredAt)))),
    one(
      db
        .select({ n: countDistinct(applicationEvents.applicationId) })
        .from(applicationEvents)
        .where(and(eq(applicationEvents.userId, userId), inArray(applicationEvents.toStatus, ["hr_interview", "tech_interview"]), inRange(applicationEvents.occurredAt))),
    ),
    one(
      db
        .select({ n: countDistinct(applicationEvents.applicationId) })
        .from(applicationEvents)
        .where(and(eq(applicationEvents.userId, userId), eq(applicationEvents.toStatus, "rejected"), inRange(applicationEvents.occurredAt))),
    ),
  ]);

  const activeApps = and(eq(applications.userId, userId), notInArray(applications.status, [...CLOSED]));
  const appCard = {
    id: applications.id,
    status: applications.status,
    nextAction: applications.nextAction,
    nextActionAt: applications.nextActionAt,
    title: jobOffers.title,
    company: companies.name,
  };
  const [overdueList, dueToday, ready, withoutAction, queued, failed, analysisLatency, periodCost, costToday, bySource, qualifiedBySource] = await Promise.all([
    db
      .select(appCard)
      .from(applications)
      .innerJoin(jobOffers, eq(jobOffers.id, applications.offerId))
      .leftJoin(companies, eq(companies.id, jobOffers.companyId))
      .where(and(activeApps, lt(applications.nextActionAt, opts.today)))
      .orderBy(asc(applications.nextActionAt)),
    db
      .select(appCard)
      .from(applications)
      .innerJoin(jobOffers, eq(jobOffers.id, applications.offerId))
      .leftJoin(companies, eq(companies.id, jobOffers.companyId))
      .where(and(activeApps, eq(applications.nextActionAt, opts.today))),
    db
      .select(appCard)
      .from(applications)
      .innerJoin(jobOffers, eq(jobOffers.id, applications.offerId))
      .leftJoin(companies, eq(companies.id, jobOffers.companyId))
      .where(and(eq(applications.userId, userId), eq(applications.status, "ready"))),
    one(db.select({ n: count() }).from(applications).where(and(activeApps, isNull(applications.nextAction)))),
    one(db.select({ n: count() }).from(jobOffers).where(and(eq(jobOffers.userId, userId), inArray(jobOffers.status, ["queued", "analyzing"])))),
    one(db.select({ n: count() }).from(jobOffers).where(and(eq(jobOffers.userId, userId), eq(jobOffers.status, "failed")))),
    db
      .select({ avg: avg(llmCalls.latencyMs), n: count() })
      .from(llmCalls)
      .where(and(eq(llmCalls.userId, userId), eq(llmCalls.purpose, "offer.extract"), eq(llmCalls.status, "ok"), inRange(llmCalls.createdAt))),
    one(db.select({ n: sum(llmCalls.costUsd) }).from(llmCalls).where(and(eq(llmCalls.userId, userId), inRange(llmCalls.createdAt)))),
    spentTodayUsd(db, userId),
    db
      .select({ source: offerImports.source, collected: count(), duplicates: sql<number>`count(*) filter (where ${offerImports.outcome} = 'duplicate')`.mapWith(Number) })
      .from(offerImports)
      .where(and(eq(offerImports.userId, userId), inRange(offerImports.createdAt)))
      .groupBy(offerImports.source),
    db
      .select({ source: jobOffers.source, n: countDistinct(offerEvents.offerId) })
      .from(offerEvents)
      .innerJoin(jobOffers, eq(jobOffers.id, offerEvents.offerId))
      .where(and(eq(offerEvents.userId, userId), eq(offerEvents.type, "qualified"), inRange(offerEvents.occurredAt)))
      .groupBy(jobOffers.source),
  ]);

  const days = opts.period === "day" ? 1 : 7;
  const sources = (["url", "text", "file"] as const).map((source) => {
    const row = bySource.find((r) => r.source === source);
    return {
      source,
      collected: Number(row?.collected ?? 0),
      duplicates: Number(row?.duplicates ?? 0),
      qualified: Number(qualifiedBySource.find((r) => r.source === source)?.n ?? 0),
    };
  });

  return {
    range: { from, to },
    goal: { processed, target: opts.dailyGoal * days },
    funnel: { collected, fresh, analyzed, qualified, cvFinalized, prepared, sent, interviews },
    results: { sent, interviews, refusals, overdue: overdueList.length },
    rates: { duplicates: ratio(collected - fresh, collected), qualification: ratio(qualified, analyzed), qualifiedToSent: ratio(sent, qualified) },
    health: {
      queued,
      failed,
      avgAnalysisMs: analysisLatency[0]?.avg != null ? Math.round(Number(analysisLatency[0].avg)) : null,
      analysesMeasured: Number(analysisLatency[0]?.n ?? 0),
      periodCostUsd: periodCost,
      costTodayUsd: costToday,
      budgetUsd: dailyBudgetUsd(),
    },
    todo: { overdue: overdueList, dueToday, ready, withoutAction, failedAnalyses: failed },
    sources,
  };
}

export type Dashboard = Awaited<ReturnType<typeof getDashboard>>;
