import { describe, expect, it } from "vitest";
import { exclusionHit, formatDuration, professionalMonths, yearsRule } from "@/modules/matching/rules";
import { computeScore, DEFAULT_WEIGHTS, type ScoredItem } from "@/modules/matching/score";
import { emptyProfile, type ProfileContent } from "@/modules/profile/content";

const item = (category: ScoredItem["category"], importance: ScoredItem["importance"] = "mandatory", kind = "hard_skill"): ScoredItem => ({ kind, importance, category });

describe("score déterministe", () => {
  it("pondère la moyenne des catégories par facteur", () => {
    const { score, factors } = computeScore([
      item("confirmed"),
      item("partial"),
      item("confirmed", "preferred"),
      item("confirmed", "mandatory", "years"),
      item("potential_incompatibility", "condition"),
    ]);
    // obligatoires 0,75 × 50 + souhaités 1 × 20 + expérience 1 × 15 + conditions 0 × 15 = 72,5
    expect(score).toBe(73);
    expect(factors.find((f) => f.factor === "mandatory")).toMatchObject({ value: 0.75, points: 37.5, maxPoints: 50 });
  });

  it("donne toujours le même score pour les mêmes catégories, et réagit aux poids", () => {
    const items = [item("confirmed"), item("not_demonstrated", "preferred")];
    expect(computeScore(items).score).toBe(computeScore(items).score);
    expect(computeScore(items, { ...DEFAULT_WEIGHTS, preferred: 0 }).score).toBe(100);
  });

  it("ignore un facteur sans exigence et les exigences non applicables", () => {
    expect(computeScore([item("confirmed"), item("not_applicable")]).score).toBe(100);
    expect(computeScore([]).score).toBeNull();
  });

  it("compte un inconnu moins qu'une correspondance mais plus qu'une lacune", () => {
    const s = (c: ScoredItem["category"]) => computeScore([item(c)]).score!;
    expect(s("confirmed")).toBeGreaterThan(s("to_confirm"));
    expect(s("to_confirm")).toBeGreaterThan(s("not_demonstrated"));
  });
});

describe("années d'expérience", () => {
  const profile = (experiences: Array<[string | null, string | null, boolean]>): ProfileContent => ({
    ...emptyProfile(),
    experiences: experiences.map(([start, end, current], i) => ({ id: `exp-00${i}`, title: "Data Engineer", company: `E${i}`, location: null, start, end, current, items: [] })),
  });
  const today = new Date("2026-10-18T12:00:00Z");

  it("fusionne les périodes qui se chevauchent", () => {
    const p = profile([
      ["2021-06", "2023-08", false],
      ["2023-01", "2024-12", false],
      ["2025-03", null, true],
    ]);
    // 06/2021 → 12/2024 = 43 mois ; 03/2025 → 10/2026 = 20 mois
    expect(professionalMonths(p, today)).toEqual({ months: 63, undated: 0 });
    expect(formatDuration(63)).toBe("5 ans et 3 mois");
  });

  it("classe l'exigence selon les dates, sans estimation", () => {
    const p = profile([["2021-06", null, true]]);
    expect(yearsRule(5, p, today).category).toBe("confirmed");
    expect(yearsRule(6, p, today).category).toBe("partial");
    expect(yearsRule(10, p, today).category).toBe("not_demonstrated");
    const undated = profile([[null, null, false]]);
    expect(yearsRule(3, undated, today)).toMatchObject({ category: "to_confirm", action: "Compléter les dates manquantes dans le profil maître." });
  });
});

describe("critères d'exclusion", () => {
  it("repère un mot exclu, sans faux positif sur une sous-chaîne", () => {
    expect(exclusionHit({ label: "Stage de fin d'études", value: "6 mois" }, ["stage", "ESN"])).toBe("stage");
    expect(exclusionHit({ label: "Data Engineer junior", value: null }, ["junior"])).toBe("junior");
    expect(exclusionHit({ label: "Stagiaire", value: null }, ["stage"])).toBeNull();
    expect(exclusionHit({ label: "CDI", value: null }, [])).toBeNull();
  });
});
