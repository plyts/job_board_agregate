import type { MatchCategory } from "@/modules/matching/score";

/** Ordre de couverture d'une exigence ; « non applicable » n'entre pas dans la comparaison. */
const RANK: Record<MatchCategory, number | null> = {
  confirmed: 4,
  partial: 3,
  to_confirm: 2,
  not_demonstrated: 1,
  potential_incompatibility: 0,
  not_applicable: null,
};

export type CompareItem = { requirementId: string; label: string; category: MatchCategory; rationale: string };
export type CategoryChange = { label: string; before: MatchCategory | null; after: MatchCategory; rationale: string };

/**
 * Écart entre le matching du profil maître et celui du CV personnalisé, exigence par exigence.
 * Les exigences sont rapprochées par identifiant, puis par intitulé si l'offre a été réanalysée entre-temps.
 */
export function compareCoverage(before: CompareItem[], after: CompareItem[]) {
  const byId = new Map(before.map((b) => [b.requirementId, b]));
  const byLabel = new Map(before.map((b) => [b.label.trim().toLowerCase(), b]));
  const improved: CategoryChange[] = [];
  const worsened: CategoryChange[] = [];
  const persistent: CategoryChange[] = [];
  for (const a of after) {
    const b = byId.get(a.requirementId) ?? byLabel.get(a.label.trim().toLowerCase()) ?? null;
    const change: CategoryChange = { label: a.label, before: b?.category ?? null, after: a.category, rationale: a.rationale };
    const ra = RANK[a.category];
    const rb = b ? RANK[b.category] : null;
    if (ra === null) continue;
    if (rb !== null && ra > rb) improved.push(change);
    else if (rb !== null && ra < rb) worsened.push(change);
    else if (a.category !== "confirmed") persistent.push(change);
  }
  return { improved, worsened, persistent };
}
