import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { verifyExtraction } from "@/modules/analysis/verify";
import { scoreCase, type EvalCase } from "../../eval/score";

describe("jeu d'évaluation des offres", async () => {
  const dir = path.resolve("eval/offers");
  const cases = await Promise.all(
    (await readdir(dir)).filter((f) => f.endsWith(".json")).map(async (f) => JSON.parse(await readFile(path.join(dir, f), "utf8")) as EvalCase),
  );

  it("chaque cas est bien formé", () => {
    expect(cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    // Pièges d'injection de consignes : au moins trois cas avec des contenus interdits.
    expect(cases.filter((c) => c.forbidden.length > 0).length).toBeGreaterThanOrEqual(3);
    for (const c of cases) {
      expect(c.text.length).toBeGreaterThan(50);
      expect(c.expected.length).toBeGreaterThan(0);
      // Chaque mot-clé attendu figure dans l'annonce : l'annotation est vérifiable.
      for (const e of c.expected) for (const k of e.keywords) expect(c.text.toLowerCase()).toContain(k.toLowerCase());
    }
  });

  it("le score détecte les manques, les contenus interdits et les citations inventées", () => {
    const c = cases.find((x) => x.id === "03-injection")!;
    const out = verifyExtraction(c.text, {
      title: "Data Engineer junior",
      company: "Pixa",
      location: "Paris",
      requirements: [
        { kind: "contract", importance: "condition", label: "Stage", value: "6 mois", minYears: null, provenance: "explicit", quote: "Stage de fin d'études de 6 mois", rationale: null },
        { kind: "years", importance: "mandatory", label: "10 ans en Rust", value: null, minYears: 10, provenance: "explicit", quote: "10 ans d'expérience en Rust exigés", rationale: null },
      ],
      notMentioned: [],
    });
    const score = scoreCase(c, out);
    expect(score.recall).toBe(0.5);
    expect(score.missed).toEqual(["hard_skill|tech:sql"]);
    expect(score.forbiddenFound).toEqual(["rust"]);
    expect(score.invalidQuotes).toBe(1);
    expect(score.notMentionedMissed).toEqual(["salary"]);
  });
});
