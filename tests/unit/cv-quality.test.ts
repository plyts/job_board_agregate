import { describe, expect, it } from "vitest";
import { cvFromProfile } from "@/modules/cv/content";
import { actionStart, cvQuality, profileQuality, QUALITY_RULES_VERSION, reverseChronological } from "@/modules/cv/quality";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";

const { content: profile } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: null, phone: null });
const TODAY = new Date("2026-10-18T12:00:00Z");
const [lumio, sencia] = profile.experiences;

describe("verbe d'action en tête de puce", () => {
  it("reconnaît les noms d'action, les participes et les formules faibles", () => {
    expect(actionStart("Développement d'un portefeuille de 45 clients (+15 % de CA en 1 an).")).toBe("action");
    expect(actionStart("Pilotage de la refonte du site")).toBe("action");
    expect(actionStart("Piloté la migration vers GCP")).toBe("action");
    expect(actionStart("Conçu un outil interne")).toBe("action");
    expect(actionStart("Led a team of 4 engineers")).toBe("action");
    expect(actionStart("En charge de la gestion des clients et des ventes.")).toBe("weak");
    expect(actionStart("Responsable des relations fournisseurs")).toBe("weak");
    expect(actionStart("Participation au comité produit")).toBe("weak");
    expect(actionStart("Responsible for data quality")).toBe("weak");
    expect(actionStart("Développer des tableaux de bord")).toBe("infinitive");
    expect(actionStart("Clients grands comptes du secteur bancaire")).toBe("other");
  });
});

describe("bonnes pratiques du profil maître", () => {
  it("vérifie ordre, nombre de puces, verbes, chiffres et longueur, avec la version des règles", () => {
    const r = profileQuality(profile, TODAY);
    expect(r.rulesVersion).toBe(QUALITY_RULES_VERSION);
    expect(r.rules.order?.status).toBe("ok");
    expect(r.rules.action_verb).toMatchObject({ status: "ok", passed: 3, total: 3 });
    expect(r.rules.quantified).toMatchObject({ status: "ok", passed: 2, total: 3 });
    expect(r.rules.bullets).toMatchObject({ status: "info", passed: 0, total: 2 });
    expect(r.rules.keywords).toBeUndefined();
    // 5 règles applicables : 4 respectées, 1 recommandation (moitié) → 90.
    expect(r.score).toBe(90);
  });

  it("signale un ordre non antéchronologique, une formule faible, un bloc de texte et trop de puces sur un poste ancien", () => {
    const p = structuredClone(profile);
    p.experiences = [p.experiences[1]!, p.experiences[0]!];
    p.experiences[1]!.items[0]!.text = "En charge de la maintenance des pipelines.";
    p.experiences[0]!.items[0]!.text = `Ingestion ${"très ".repeat(80)}longue.`;
    p.experiences.push({ id: "ancien01", title: "Analyste", company: "Vieux SI", location: null, start: "2008-01", end: "2010-06", current: false, items: ["a", "b", "c", "d"].map((x, i) => ({ id: `anc${i}xx`, kind: "mission" as const, text: `Réalisation ${x}` })) });
    const r = profileQuality(p, TODAY);
    expect(reverseChronological(p.experiences)).toEqual([lumio!.id, sencia!.id, "ancien01"]);
    expect(r.checks.find((c) => c.rule === "order")).toMatchObject({ status: "warn", sourceId: lumio!.id });
    expect(r.checks.find((c) => c.rule === "action_verb" && c.status === "warn")?.message).toContain("formule passive");
    expect(r.checks.find((c) => c.rule === "length")?.status).toBe("warn");
    expect(r.checks.find((c) => c.rule === "bullets" && c.sourceId === "ancien01")).toMatchObject({ status: "warn" });
    expect(r.score).toBeLessThan(50);
  });
});

describe("bonnes pratiques du CV personnalisé", () => {
  it("distingue mots-clés repris, prouvés mais absents, et lacunes à ne pas ajouter", () => {
    const cv = cvFromProfile(profile);
    cv.experiences[0]!.items = cv.experiences[0]!.items.slice(0, 1); // la puce BigQuery est retirée
    const r = cvQuality(cv, profile, ["Python", "BigQuery", "dbt"], TODAY);
    expect(r.keywords).toEqual([
      { term: "Python", status: "used", provenBy: expect.any(Array) },
      { term: "BigQuery", status: "available", provenBy: [{ id: lumio!.items[1]!.id, label: expect.stringContaining("Lumio") }] },
      { term: "dbt", status: "gap", provenBy: [] },
    ]);
    expect(r.rules.keywords).toMatchObject({ status: "warn", passed: 1, total: 2 });
    expect(r.checks.find((c) => c.rule === "keywords" && c.status === "info")?.message).toContain("Ne l'ajoute pas");
  });
});
