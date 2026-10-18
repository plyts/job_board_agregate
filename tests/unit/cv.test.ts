import { describe, expect, it } from "vitest";
import { cvAsProfile, cvFromProfile, renderCv, type CvContent } from "@/modules/cv/content";
import { lineDiff } from "@/modules/cv/diff";
import { compareCoverage, type CompareItem } from "@/modules/cv/recheck";
import { factCheck, hasBlocking, letterFactCheck, offerTermsFrom } from "@/modules/cv/factcheck";
import { applySuggestion, checkSuggestion, guardSuggestions, revertSuggestion, type RawSuggestion } from "@/modules/cv/suggestions";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";

const { content: profile } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "c@exemple.fr", phone: null });
const TODAY = new Date("2026-10-18T12:00:00Z");
const terms = ["dbt", "Kafka", "Python", "Kubernetes"];
const clone = (cv: CvContent) => structuredClone(cv);

describe("CV personnalisé", () => {
  const base = cvFromProfile(profile);

  it("reprend tout le profil, avec les sources de chaque élément", () => {
    expect(base.experiences.map((e) => e.sourceId)).toEqual(profile.experiences.map((e) => e.id));
    expect(base.experiences[0]!.items[0]!.sourceId).toBe(profile.experiences[0]!.items[0]!.id);
    expect(factCheck(base, profile, terms, TODAY).filter((i) => i.severity === "blocking")).toEqual([]);
  });

  it("rend les faits depuis le profil, jamais depuis le CV", () => {
    const rendered = renderCv(base, profile);
    const exp = rendered.find((s) => s.title === "Expérience professionnelle")!;
    expect(exp.lines[0]).toBe("Data Engineer — Lumio (09/2023 – aujourd'hui)");
    expect(exp.lines).toContain("• Migration de l'entrepôt vers BigQuery, 4 To.");
  });

  it("ne garde dans le profil recalculé que ce que le CV montre", () => {
    const cv = clone(base);
    cv.experiences = cv.experiences.slice(0, 1);
    cv.projects = [];
    const restricted = cvAsProfile(cv, profile);
    expect(restricted.experiences.map((e) => e.company)).toEqual(["Lumio"]);
    const python = restricted.skills.find((s) => s.name === "Python")!;
    expect(python.evidence).toEqual([profile.experiences[0]!.id]);
    expect(restricted.skills.find((s) => s.name === "Spark")?.evidence).toEqual([]);
  });

  it("accepte une reformulation fidèle", () => {
    const cv = clone(base);
    cv.experiences[0]!.items[0]!.text = "Industrialisation de 30 pipelines Python/SQL sous Airflow, en production depuis 2023.";
    expect(hasBlocking(factCheck(cv, profile, terms, TODAY))).toBe(false);
  });

  it("bloque un chiffre inventé et un mot-clé de l'offre ajouté sans preuve", () => {
    const cv = clone(base);
    cv.experiences[0]!.items[0]!.text = "Développement de 45 pipelines dbt orchestrés par Airflow.";
    expect(factCheck(cv, profile, terms, TODAY).filter((i) => i.severity === "blocking").map((i) => i.message)).toEqual([
      "Lumio : le chiffre « 45 » n'apparaît pas dans la source.",
      "Lumio : « dbt » est ajouté sans preuve dans la source.",
    ]);
  });

  it("bloque un élément sans source et signale une compétence non confirmée", () => {
    const cv = clone(base);
    expect(cv.skills).not.toContain(profile.skills.find((s) => s.name === "Terraform")!.id);
    cv.skills.push(profile.skills.find((s) => s.name === "Terraform")!.id);
    cv.experiences[0]!.items.push({ sourceId: "inventee1", text: "Expert Kubernetes." });
    const issues = factCheck(cv, profile, terms, TODAY);
    expect(issues).toContainEqual({ severity: "blocking", sourceId: "inventee1", message: "Lumio : élément sans source dans le profil maître." });
    expect(issues.filter((i) => i.severity === "warning").map((i) => i.message)).toContain("Compétence « Terraform » mise en avant sans preuve dans le profil.");
  });

  it("autorise dans le résumé la durée d'expérience calculée, pas une autre", () => {
    const cv = clone(base);
    cv.summary = { text: "Data Engineer, 5 ans d'expérience sur Python et Airflow.", sourceIds: [profile.experiences[0]!.id] };
    expect(hasBlocking(factCheck(cv, profile, terms, TODAY))).toBe(false);
    cv.summary.text = "Data Engineer, 8 ans d'expérience.";
    expect(hasBlocking(factCheck(cv, profile, terms, TODAY))).toBe(true);
  });
});

describe("diff ligne à ligne", () => {
  it("montre les lignes ajoutées, retirées et inchangées", () => {
    expect(lineDiff(["a", "b", "c"], ["a", "c", "d"])).toEqual([
      { op: "same", text: "a" },
      { op: "removed", text: "b" },
      { op: "same", text: "c" },
      { op: "added", text: "d" },
    ]);
    expect(lineDiff([], ["x"])).toEqual([{ op: "added", text: "x" }]);
  });
});

describe("suggestions sourcées", () => {
  const base = cvFromProfile(profile);
  const lumio = profile.experiences[0]!;
  const [mission, achievement] = lumio.items;
  const terraform = profile.skills.find((s) => s.name === "Terraform")!;
  const raw = (s: Partial<RawSuggestion> & Pick<RawSuggestion, "kind">): RawSuggestion => ({
    targetId: null,
    text: null,
    order: null,
    sourceIds: [],
    rationale: "Pour l'offre.",
    covers: null,
    ...s,
  });

  it("garde une reformulation fidèle et l'applique, puis l'annule", () => {
    const [s] = guardSuggestions([raw({ kind: "rephrase", targetId: mission!.id, text: "Conception de 30 pipelines Python/SQL sous Airflow." })], base, profile, terms, TODAY);
    expect(s).toMatchObject({ state: "pending", sourceIds: [mission!.id] });
    const applied = applySuggestion(base, s!, profile)!;
    expect(applied.cv.experiences[0]!.items[0]!.text).toBe("Conception de 30 pipelines Python/SQL sous Airflow.");
    expect(base.experiences[0]!.items[0]!.text).toBe(mission!.text);
    expect(revertSuggestion(applied.cv, s!, applied.before)).toEqual(base);
  });

  it("bloque une suggestion qui ajoute un chiffre ou un mot-clé de l'offre sans preuve", () => {
    const out = guardSuggestions(
      [
        raw({ kind: "rephrase", targetId: mission!.id, text: "Conception de 50 pipelines Python." }),
        raw({ kind: "rephrase", targetId: achievement!.id, text: "Migration vers BigQuery (4 To) avec dbt." }),
        raw({ kind: "include", targetId: terraform.id }),
      ],
      base,
      profile,
      terms,
      TODAY,
    );
    expect(out.map((s) => s.state)).toEqual(["blocked", "blocked", "blocked"]);
    expect(out[0]!.blockReason).toContain("« 50 »");
    expect(out[1]!.blockReason).toContain("« dbt »");
    expect(out[2]!.blockReason).toBe("« Terraform » n'a aucune preuve dans le profil maître.");
  });

  it("écarte sans l'afficher une suggestion sans source vérifiable ou qui ne s'applique pas", () => {
    const out = guardSuggestions(
      [
        raw({ kind: "summary", text: "Data Engineer passionné.", sourceIds: ["inventee1"] }),
        raw({ kind: "rephrase", targetId: "inventee1", text: "Expert." }),
        raw({ kind: "reorder_items", targetId: lumio.id, order: [achievement!.id] }),
      ],
      base,
      profile,
      terms,
      TODAY,
    );
    expect(out).toEqual([]);
  });

  it("réordonne les puces d'une expérience et inclut un élément du profil", () => {
    const cv = clone(base);
    cv.projects = [];
    const [reorder, include] = guardSuggestions(
      [
        raw({ kind: "reorder_items", targetId: lumio.id, order: [achievement!.id, mission!.id] }),
        raw({ kind: "include", targetId: profile.projects[0]!.id }),
      ],
      cv,
      profile,
      terms,
      TODAY,
    );
    expect(reorder!.state).toBe("pending");
    expect(applySuggestion(cv, reorder!, profile)!.cv.experiences[0]!.items.map((i) => i.sourceId)).toEqual([achievement!.id, mission!.id]);
    const withProject = applySuggestion(cv, include!, profile)!;
    expect(withProject.cv.projects).toEqual([{ sourceId: profile.projects[0]!.id, description: profile.projects[0]!.description }]);
    expect(revertSuggestion(withProject.cv, include!, withProject.before)).toEqual(cv);
  });

  it("refuse d'annuler une reformulation modifiée depuis", () => {
    const [s] = guardSuggestions([raw({ kind: "rephrase", targetId: mission!.id, text: "Conception de 30 pipelines Python/SQL." })], base, profile, terms, TODAY);
    const applied = applySuggestion(base, s!, profile)!;
    applied.cv.experiences[0]!.items[0]!.text = "Saisie manuelle.";
    expect(revertSuggestion(applied.cv, s!, applied.before)).toBeNull();
  });

  it("vérifie une suggestion modifiée par l'utilisateur comme une suggestion du modèle", () => {
    const [s] = guardSuggestions([raw({ kind: "rephrase", targetId: mission!.id, text: "30 pipelines Python." })], base, profile, terms, TODAY);
    expect(checkSuggestion(base, { ...s!, text: "30 pipelines Python sur Kafka." }, profile, terms, TODAY)).toMatchObject({ ok: false });
    expect(checkSuggestion(base, { ...s!, text: "30 pipelines Python et SQL." }, profile, terms, TODAY)).toMatchObject({ ok: true });
  });
});

describe("mots-clés de l'offre", () => {
  it("découpe les intitulés composés et ignore les exigences non techniques", () => {
    expect(
      offerTermsFrom([
        { kind: "hard_skill", label: "Python et SQL" },
        { kind: "tech", label: "Spark (Databricks)" },
        { kind: "remote", label: "Présence sur site" },
        { kind: "tech", label: "dbt" },
      ]),
    ).toEqual(["Python", "SQL", "Spark", "Databricks", "dbt"]);
  });
});

describe("écart du recontrôle", () => {
  it("classe les exigences mieux couvertes, moins bien couvertes et les lacunes persistantes", () => {
    const item = (requirementId: string, label: string, category: CompareItem["category"]): CompareItem => ({ requirementId, label, category, rationale: `${label} ${category}` });
    const { improved, worsened, persistent } = compareCoverage(
      [item("r1", "Python", "partial"), item("r2", "Expérience", "confirmed"), item("r3", "dbt", "to_confirm"), item("r4", "Anglais", "confirmed"), item("old", "Kafka", "not_demonstrated")],
      [item("r1", "Python", "confirmed"), item("r2", "Expérience", "partial"), item("r3", "dbt", "to_confirm"), item("r4", "Anglais", "confirmed"), item("new", "kafka ", "partial")],
    );
    expect(improved.map((c) => c.label)).toEqual(["Python", "kafka "]);
    expect(worsened).toEqual([{ label: "Expérience", before: "confirmed", after: "partial", rationale: "Expérience partial" }]);
    expect(persistent.map((c) => c.label)).toEqual(["dbt"]);
  });
});

describe("contrôle des faits de la lettre", () => {
  it("accepte les chiffres et mots-clés prouvés, bloque les autres", () => {
    const ok = "Depuis 2023 chez Lumio, j'ai industrialisé 30 pipelines Python et migré 4 To vers BigQuery : 5 ans d'expérience.";
    expect(letterFactCheck(ok, profile, terms, TODAY)).toEqual([]);
    expect(letterFactCheck("J'ai mené 12 projets dbt sur Kafka.", profile, terms, TODAY).map((i) => i.message)).toEqual([
      "Lettre : le chiffre « 12 » n'apparaît pas dans le profil maître.",
      "Lettre : « dbt » est mis en avant sans preuve dans le profil maître.",
      "Lettre : « Kafka » est mis en avant sans preuve dans le profil maître.",
    ]);
  });
});
