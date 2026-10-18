import { describe, expect, it } from "vitest";
import type { ExtractedRequirement, OfferExtraction } from "@/modules/analysis/schema";
import { locateQuote, verifyExtraction } from "@/modules/analysis/verify";

const RAW = `Senior Data Engineer – Nordwave
Profil : au moins 5 ans d’expérience en ingénierie des données, maîtrise de Python et SQL.
Expérience significative de Spark (Databricks). dbt et Kafka sont un plus.
Poste basé à Lyon, 3 jours par semaine sur site. Rémunération selon profil.`;

const req = (r: Partial<ExtractedRequirement>): ExtractedRequirement => ({
  kind: "hard_skill",
  importance: "mandatory",
  label: "Python",
  value: null,
  minYears: null,
  provenance: "explicit",
  quote: null,
  rationale: null,
  ...r,
});

const extraction = (requirements: ExtractedRequirement[], notMentioned: OfferExtraction["notMentioned"] = []): OfferExtraction => ({
  title: " Senior Data Engineer ",
  company: "Nordwave",
  location: "",
  requirements,
  notMentioned,
});

describe("localisation des citations", () => {
  it("retrouve une citation malgré casse, apostrophes et espaces", () => {
    const pos = locateQuote(RAW, "au moins 5 ans d'expérience en ingénierie des données");
    expect(pos).not.toBeNull();
    expect(RAW.slice(pos!.start, pos!.end)).toBe("au moins 5 ans d’expérience en ingénierie des données");
  });

  it("accepte une citation coupée par des points de suspension si les fragments sont dans l'ordre", () => {
    const pos = locateQuote(RAW, "Expérience significative … (Databricks)");
    expect(RAW.slice(pos!.start, pos!.end)).toBe("Expérience significative de Spark (Databricks");
    expect(locateQuote(RAW, "Databricks … Expérience significative")).toBeNull();
  });

  it("refuse une citation inventée ou trop courte", () => {
    expect(locateQuote(RAW, "10 ans d'expérience en management")).toBeNull();
    expect(locateQuote(RAW, "à")).toBeNull();
  });
});

describe("vérification de l'extraction", () => {
  it("garde une exigence explicite dont la citation existe, avec sa position", () => {
    const out = verifyExtraction(RAW, extraction([req({ quote: "maîtrise de Python et SQL" })]));
    expect(out.requirements[0]).toMatchObject({ provenance: "explicit", verificationNote: null });
    expect(RAW.slice(out.requirements[0]!.quoteStart!, out.requirements[0]!.quoteEnd!)).toBe("maîtrise de Python et SQL");
    expect(out.title).toBe("Senior Data Engineer");
    expect(out.location).toBeNull();
  });

  it("déclasse en incertaine une exigence « explicite » à la citation inventée", () => {
    const out = verifyExtraction(RAW, extraction([req({ label: "Kubernetes", quote: "maîtrise de Kubernetes exigée" })]));
    expect(out.requirements[0]).toMatchObject({ provenance: "uncertain", quote: null, verificationNote: "Citation introuvable dans l'annonce : à vérifier." });
  });

  it("déclasse une exigence explicite sans citation et une déduction sans justification", () => {
    const out = verifyExtraction(
      RAW,
      extraction([req({ label: "SQL" }), req({ kind: "seniority", label: "Senior", provenance: "inferred", rationale: null })]),
    );
    expect(out.requirements.map((r) => r.provenance)).toEqual(["uncertain", "uncertain"]);
  });

  it("conserve une déduction justifiée mais retire un extrait introuvable", () => {
    const out = verifyExtraction(
      RAW,
      extraction([req({ kind: "seniority", label: "Senior", provenance: "inferred", rationale: "Titre du poste et 5 ans requis", quote: "poste de senior" })]),
    );
    expect(out.requirements[0]).toMatchObject({ provenance: "inferred", quote: null, verificationNote: "L'extrait cité est introuvable dans l'annonce." });
  });

  it("dédoublonne, ignore les libellés vides et borne les années", () => {
    const out = verifyExtraction(
      RAW,
      extraction([
        req({ quote: "Python" }),
        req({ label: "python", quote: "Python" }),
        req({ label: "  " }),
        req({ kind: "years", label: "Expérience", minYears: 99, quote: "au moins 5 ans" }),
      ]),
    );
    expect(out.requirements.map((r) => r.label)).toEqual(["Python", "Expérience"]);
    expect(out.requirements[1]?.minYears).toBeNull();
  });

  it("ne déclare pas absent un type d'information effectivement extrait", () => {
    const out = verifyExtraction(RAW, extraction([req({ kind: "salary", label: "Rémunération", provenance: "uncertain", rationale: "« selon profil »" })], ["salary", "clearance", "clearance"]));
    expect(out.notMentioned).toEqual(["clearance"]);
  });
});
