import type { IncomingOffer } from "@/modules/offers";
import { date, htmlToText, requestJson, str } from "../http";
import type { SearchConnector, SearchOutcome } from "../types";

/**
 * API Adzuna (agrégateur), pays « fr ». Clé gratuite (app_id, app_key) sur developer.adzuna.com.
 * Les descriptions sont des extraits : l'offre arrive « à compléter », avec le lien Adzuna vers l'annonce
 * (les conditions d'Adzuna demandent de renvoyer vers ce lien). Quotas gratuits bas : 50 offres par recherche.
 */
export const ADZUNA = { apiUrl: "https://api.adzuna.com/v1/api/jobs/fr", pageSize: 50, intervalMs: 1000 };

export type AdzunaCredentials = { appId: string; appKey: string };

type AdzunaJob = {
  id?: string | number;
  title?: string;
  description?: string;
  redirect_url?: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
  contract_type?: string;
  contract_time?: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string | number;
};

const euros = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export function normalizeAdzuna(j: AdzunaJob): IncomingOffer | null {
  const id = j.id !== undefined ? String(j.id) : null;
  const title = str(htmlToText(j.title ?? ""));
  if (!id || !title) return null;
  // Un salaire « prédit » par Adzuna n'est pas un fait de l'annonce : il n'est pas repris.
  const salary =
    String(j.salary_is_predicted ?? "0") === "0" && (j.salary_min || j.salary_max)
      ? `Salaire : ${[j.salary_min, j.salary_max].filter(Boolean).map((v) => euros.format(v!)).join(" à ")}`
      : null;
  const contract = { permanent: "CDI", contract: "CDD ou mission" }[j.contract_type ?? ""] ?? null;
  const excerpt = [htmlToText(j.description ?? ""), contract ? `Contrat : ${contract}` : null, salary].filter(Boolean).join("\n");
  return {
    origin: "adzuna",
    board: "adzuna",
    externalId: id,
    url: str(j.redirect_url),
    title,
    company: str(j.company?.display_name),
    location: str(j.location?.display_name),
    publishedAt: date(j.created),
    text: excerpt,
    complete: false,
  };
}

export function adzunaConnector(creds: AdzunaCredentials, apiUrl = ADZUNA.apiUrl): SearchConnector {
  const call = (page: number, extra: Record<string, string>) =>
    requestJson(
      `${apiUrl}/search/${page}?${new URLSearchParams({ app_id: creds.appId, app_key: creds.appKey, "content-type": "application/json", ...extra })}`,
      { intervalMs: ADZUNA.intervalMs },
    );
  return {
    async test() {
      await call(1, { results_per_page: "1", what: "emploi" });
    },
    async search(query): Promise<SearchOutcome> {
      const params: Record<string, string> = { results_per_page: String(Math.min(ADZUNA.pageSize, query.limit)), sort_by: "date" };
      if (query.keywords.trim()) params.what = query.keywords.replace(/,/g, " ").trim();
      if (query.location?.trim()) params.where = query.location.trim();
      if (query.location?.trim() && query.radiusKm) params.distance = String(query.radiusKm);
      if (query.publishedWithinDays) params.max_days_old = String(query.publishedWithinDays);
      if (query.contracts.includes("CDI") && !query.contracts.some((c) => c === "CDD" || c === "MIS")) params.permanent = "1";
      if (!query.contracts.includes("CDI") && query.contracts.some((c) => c === "CDD" || c === "MIS")) params.contract = "1";
      const res = await call(1, params);
      const body = (res.body ?? {}) as { results?: AdzunaJob[]; count?: number };
      const offers = (body.results ?? []).map(normalizeAdzuna).filter((o): o is IncomingOffer => o !== null);
      return { offers, total: typeof body.count === "number" ? body.count : offers.length };
    },
  };
}
