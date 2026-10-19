import type { IncomingOffer } from "@/modules/offers";
import type { SearchOutcome, SearchQuery } from "../types";

/** Variantes séparées par des virgules : « data engineer, ingénieur données » cherche l'une ou l'autre. */
export const MAX_KEYWORD_GROUPS = 5;

export function keywordGroups(keywords: string): string[] {
  const groups = keywords
    .split(",")
    .map((g) => g.trim().replace(/\s+/g, " "))
    .filter((g) => g.length >= 2);
  return [...new Set(groups)].slice(0, MAX_KEYWORD_GROUPS);
}

/**
 * Une requête par variante, le quota de la recherche réparti entre elles : les API (France Travail, Adzuna)
 * combinent leurs mots-clés en « et », une seule requête ne peut donc pas exprimer le « ou » entre variantes.
 * Une offre trouvée par deux variantes n'est gardée qu'une fois.
 */
export async function searchEachGroup(query: SearchQuery, run: (keywords: string, limit: number) => Promise<SearchOutcome>): Promise<SearchOutcome> {
  const groups = keywordGroups(query.keywords);
  if (groups.length <= 1) return run(groups[0] ?? "", query.limit);
  const per = Math.max(1, Math.ceil(query.limit / groups.length));
  const seen = new Set<string>();
  const offers: IncomingOffer[] = [];
  let total = 0;
  for (const g of groups) {
    const res = await run(g, per);
    total += res.total ?? res.offers.length;
    for (const o of res.offers) {
      const id = o.externalId ?? o.url ?? `${o.title}|${o.company ?? ""}`;
      if (seen.has(id)) continue;
      seen.add(id);
      offers.push(o);
    }
  }
  return { offers, total };
}
