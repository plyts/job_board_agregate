import { describe, expect, it } from "vitest";
import { buildMatchUserMessage, guardJudgement, profileForModel } from "@/modules/matching/judge";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";

const { content } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "camille.martin@exemple.fr", phone: "+33 6 12 34 56 78" });
const lumio = content.experiences[0]!.id;
const project = content.projects[0]!.id;

describe("garde-fous du jugement", () => {
  it("garde une correspondance confirmée par une expérience réelle", () => {
    expect(guardJudgement({ requirementRef: "R1", category: "confirmed", evidenceIds: [lumio, lumio], rationale: "OK", action: "Rien" }, content)).toEqual({
      category: "confirmed",
      evidenceIds: [lumio],
      rationale: "OK",
      action: "Rien",
      source: "model",
    });
  });

  it("déclasse une correspondance sans preuve ou à la preuve inventée", () => {
    const r = guardJudgement({ requirementRef: "R1", category: "confirmed", evidenceIds: ["invente1"], rationale: "Mot-clé présent", action: "—" }, content);
    expect(r).toMatchObject({ category: "to_confirm", evidenceIds: [], source: "guard" });
    expect(r.rationale).toContain("Aucune preuve vérifiable");
  });

  it("plafonne à « partielle » une preuve issue d'un projet personnel", () => {
    const r = guardJudgement({ requirementRef: "R1", category: "confirmed", evidenceIds: [project], rationale: "Spark utilisé", action: "—" }, content);
    expect(r).toMatchObject({ category: "partial", source: "guard" });
  });

  it("n'envoie au modèle ni nom ni coordonnées", () => {
    const message = buildMatchUserMessage([{ ref: "R1", kind: "tech", importance: "mandatory", label: "Python", value: null }], content);
    expect(JSON.stringify(profileForModel(content))).not.toMatch(/Camille|exemple\.fr|12 34/);
    expect(message).not.toContain("camille.martin@exemple.fr");
    expect(message).toMatch(/<document kind="candidate_profile" id="[0-9a-f]{16}">/);
  });
});
