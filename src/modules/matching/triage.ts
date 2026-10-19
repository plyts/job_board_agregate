import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { companies, jobOffers, matchAnalyses, offerAnalyses } from "@/db/schema";
import { getCurrentProfile } from "@/modules/profile";
import { DEFAULT_WEIGHTS } from "./score";
import { requestMatch, type MatchRequestDeps } from "./service";

export type AutoMatchResult = "requested" | "up_to_date" | "no_profile" | "no_analysis";

/**
 * Matching lancé sans clic après une analyse : avec les poids du matching courant s'il existe (réglage conservé),
 * et seulement si l'analyse ou le profil validé ont changé depuis. Sans fournisseur IA autorisé pour le profil,
 * le worker calcule le score par règles seules et le signale.
 */
export async function autoMatch(deps: MatchRequestDeps, userId: string, offerId: string): Promise<AutoMatchResult> {
  const profile = await getCurrentProfile(deps.db, userId);
  if (!profile) return "no_profile";
  const [analysis] = await deps.db
    .select({ id: offerAnalyses.id })
    .from(offerAnalyses)
    .where(and(eq(offerAnalyses.offerId, offerId), eq(offerAnalyses.userId, userId), eq(offerAnalyses.state, "current")))
    .limit(1);
  if (!analysis) return "no_analysis";
  const [current] = await deps.db
    .select({ offerAnalysisId: matchAnalyses.offerAnalysisId, profileVersionId: matchAnalyses.profileVersionId, weights: matchAnalyses.weights })
    .from(matchAnalyses)
    .where(and(eq(matchAnalyses.offerId, offerId), eq(matchAnalyses.userId, userId), eq(matchAnalyses.state, "current"), isNull(matchAnalyses.cvVersionId)))
    .limit(1);
  if (current && current.offerAnalysisId === analysis.id && current.profileVersionId === profile.id) return "up_to_date";
  const res = await requestMatch(deps, userId, offerId, current?.weights ?? DEFAULT_WEIGHTS);
  return res.ok ? "requested" : res.code === "NO_PROFILE" ? "no_profile" : "no_analysis";
}

export type TriageItem = {
  offerId: string;
  title: string;
  company: string | null;
  location: string | null;
  source: (typeof jobOffers.$inferSelect)["source"];
  createdAt: Date;
  /** Matching courant avec le profil maître : absent, en cours, terminé ou en échec. */
  match: { status: "pending" | "done" | "failed"; score: number | null; mode: "model" | "rules_only" | null; stale: boolean } | null;
};

/**
 * Offres analysées sur lesquelles l'utilisateur n'a pas encore décidé, de la plus prometteuse à la moins prometteuse :
 * score décroissant, puis matchings en cours, puis offres sans score ; à score égal, la plus récente d'abord.
 */
export async function listToTriage(db: Db, userId: string, limit = 100): Promise<TriageItem[]> {
  const profile = await getCurrentProfile(db, userId);
  const rows = await db
    .select({
      offerId: jobOffers.id,
      title: jobOffers.title,
      company: companies.name,
      location: jobOffers.location,
      source: jobOffers.source,
      createdAt: jobOffers.createdAt,
      matchStatus: matchAnalyses.status,
      score: matchAnalyses.score,
      mode: matchAnalyses.mode,
      profileVersionId: matchAnalyses.profileVersionId,
    })
    .from(jobOffers)
    .leftJoin(companies, eq(companies.id, jobOffers.companyId))
    .leftJoin(
      matchAnalyses,
      and(eq(matchAnalyses.offerId, jobOffers.id), eq(matchAnalyses.userId, userId), eq(matchAnalyses.state, "current"), isNull(matchAnalyses.cvVersionId)),
    )
    .where(and(eq(jobOffers.userId, userId), eq(jobOffers.status, "analyzed")))
    .orderBy(
      sql`${matchAnalyses.score} desc nulls last`,
      sql`case when ${matchAnalyses.status} = 'pending' then 0 when ${matchAnalyses.status} is null then 2 else 1 end`,
      desc(jobOffers.createdAt),
    )
    .limit(limit);
  return rows.map(({ matchStatus, score, mode, profileVersionId, ...offer }) => ({
    ...offer,
    match: matchStatus ? { status: matchStatus, score, mode, stale: Boolean(profile && profileVersionId !== profile.id) } : null,
  }));
}

/** Nombre d'offres à traiter, d'offres « à compléter », et d'offres analysées sans score à jour (absent ou d'un ancien profil). */
export async function triageCounts(db: Db, userId: string) {
  const profile = await getCurrentProfile(db, userId);
  const [row] = await db
    .select({
      toDecide: sql<number>`count(*) filter (where ${jobOffers.status} = 'analyzed')`.mapWith(Number),
      incomplete: sql<number>`count(*) filter (where ${jobOffers.status} = 'incomplete')`.mapWith(Number),
      unscored: profile
        ? sql<number>`count(*) filter (where ${jobOffers.status} = 'analyzed' and (${matchAnalyses.id} is null or ${matchAnalyses.profileVersionId} <> ${profile.id}))`.mapWith(Number)
        : sql<number>`0`.mapWith(Number),
    })
    .from(jobOffers)
    .leftJoin(
      matchAnalyses,
      and(eq(matchAnalyses.offerId, jobOffers.id), eq(matchAnalyses.userId, userId), eq(matchAnalyses.state, "current"), isNull(matchAnalyses.cvVersionId)),
    )
    .where(eq(jobOffers.userId, userId));
  return { toDecide: row?.toDecide ?? 0, incomplete: row?.incomplete ?? 0, unscored: row?.unscored ?? 0, hasProfile: Boolean(profile) };
}

/**
 * Scores manquants ou calculés avec un ancien profil, pour les offres à traiter (offres analysées avant la validation du profil,
 * ou profil revalidé) : au plus `max` matchings par demande, chacun pouvant appeler le modèle (quotas).
 */
export async function requestMissingMatches(deps: MatchRequestDeps, userId: string, max = 50): Promise<number> {
  const items = await listToTriage(deps.db, userId, 500);
  let requested = 0;
  for (const item of items) {
    if (requested >= max) break;
    if (item.match && !item.match.stale) continue;
    if ((await autoMatch(deps, userId, item.offerId)) === "requested") requested++;
  }
  return requested;
}
