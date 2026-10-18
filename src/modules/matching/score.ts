export const MATCH_CATEGORIES = ["confirmed", "partial", "to_confirm", "not_demonstrated", "potential_incompatibility", "not_applicable"] as const;
export type MatchCategory = (typeof MATCH_CATEGORIES)[number];

export const FACTORS = ["mandatory", "preferred", "experience", "conditions"] as const;
export type Factor = (typeof FACTORS)[number];
export type Weights = Record<Factor, number>;

/** Pondération initiale, réglable par l'utilisateur. */
export const DEFAULT_WEIGHTS: Weights = { mandatory: 50, preferred: 20, experience: 15, conditions: 15 };

/** Valeur d'une catégorie ; « non applicable » est exclu du calcul. Un inconnu n'est pas une lacune : il compte peu, sans être nul. */
export const CATEGORY_VALUE: Record<Exclude<MatchCategory, "not_applicable">, number> = {
  confirmed: 1,
  partial: 0.5,
  to_confirm: 0.25,
  not_demonstrated: 0,
  potential_incompatibility: 0,
};

export type ScoredItem = { kind: string; importance: "mandatory" | "preferred" | "condition"; category: MatchCategory };

export function factorOf(item: Pick<ScoredItem, "kind" | "importance">): Factor {
  if (item.kind === "years" || item.kind === "seniority") return "experience";
  if (item.importance === "condition") return "conditions";
  return item.importance === "preferred" ? "preferred" : "mandatory";
}

export type FactorScore = { factor: Factor; weight: number; value: number | null; items: number; points: number; maxPoints: number };

/**
 * Score déterministe : moyenne des catégories par facteur, pondérée. Un facteur sans exigence évaluable
 * est ignoré et son poids redistribué. Même entrée, même score.
 */
export function computeScore(items: ScoredItem[], weights: Weights = DEFAULT_WEIGHTS): { score: number | null; factors: FactorScore[] } {
  const present = FACTORS.map((factor) => {
    const values = items
      .filter((i) => factorOf(i) === factor && i.category !== "not_applicable")
      .map((i) => CATEGORY_VALUE[i.category as keyof typeof CATEGORY_VALUE]);
    const value = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
    return { factor, weight: Math.max(0, weights[factor]), value, items: values.length };
  });
  const totalWeight = present.filter((f) => f.value !== null).reduce((s, f) => s + f.weight, 0);
  const factors: FactorScore[] = present.map((f) => {
    const maxPoints = f.value === null || totalWeight === 0 ? 0 : (f.weight / totalWeight) * 100;
    return { ...f, maxPoints: Math.round(maxPoints * 10) / 10, points: f.value === null ? 0 : Math.round(maxPoints * f.value * 10) / 10 };
  });
  if (totalWeight === 0) return { score: null, factors };
  const score = factors.reduce((s, f) => s + (f.value === null ? 0 : (f.weight / totalWeight) * 100 * f.value), 0);
  return { score: Math.round(score), factors };
}
