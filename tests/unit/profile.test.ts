import { AlignmentType, Document, Packer, Paragraph } from "docx";
import { describe, expect, it } from "vitest";
import { emptyProfile, evidenceElements, experienceMonths, validationProblems, type ProfileContent } from "@/modules/profile/content";
import { readCvFile, redactContacts, toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";
import { minimalPdf } from "../helpers/pdf";

describe("masquage des coordonnées", () => {
  it("retire e-mail et téléphone avant l'envoi au modèle et les conserve localement", () => {
    const r = redactContacts(CV_TEXT);
    expect(r.email).toBe("camille.martin@exemple.fr");
    expect(r.phone).toBe("+33 6 12 34 56 78");
    expect(r.redacted).not.toContain("camille.martin@exemple.fr");
    expect(r.redacted).not.toContain("12 34 56 78");
    expect(r.redacted).toContain("[e-mail]");
  });

  it("ne confond pas dates et années avec un numéro de téléphone", () => {
    const text = "Poste 2019 2021 2022, de 06/2021 à 08/2023, 30 pipelines, 4 To.";
    expect(redactContacts(text).redacted).toBe(text);
    expect(redactContacts("Tél. 06.12.34.56.78").phone).toBe("06.12.34.56.78");
  });
});

describe("conversion de l'extraction en profil", () => {
  const { content, uncertainties } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "c@exemple.fr", phone: null });

  it("donne un identifiant stable à chaque élément et sépare missions et réalisations", () => {
    expect(content.identity).toMatchObject({ fullName: "Camille Martin", email: "c@exemple.fr", phone: null });
    expect(content.experiences[0]?.items.map((i) => i.kind)).toEqual(["mission", "achievement"]);
    const ids = evidenceElements(content).map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("rattache les preuves des compétences et rétrograde une compétence sans preuve", () => {
    const byName = Object.fromEntries(content.skills.map((s) => [s.name, s]));
    expect(byName.Python?.evidence).toEqual([content.experiences[0]!.id, content.experiences[1]!.id]);
    expect(byName.Spark).toMatchObject({ level: "learning", evidence: [content.projects[0]!.id] });
    expect(byName.Terraform).toMatchObject({ level: "unconfirmed", evidence: [] });
    // Index de preuve invalide : ignoré, donc compétence sans preuve.
    expect(byName.Kubernetes).toMatchObject({ level: "unconfirmed", evidence: [] });
  });

  it("signale ce qui est absent du CV source, en plus des doutes du modèle", () => {
    expect(uncertainties.map((u) => u.note)).toEqual([
      "Poste peut-être terminé en 2026.",
      "Compétence absente du CV source : à confirmer ou supprimer.",
    ]);
    expect(uncertainties[1]?.field).toBe("Compétence Kubernetes");
    expect(validationProblems(content)).toEqual([]);
  });
});

describe("règles de validation du profil", () => {
  const base = (): ProfileContent => ({
    ...emptyProfile(),
    identity: { ...emptyProfile().identity, fullName: "Camille Martin" },
    experiences: [{ id: "exp-0001", title: "Data Engineer", company: "Lumio", location: null, start: "2023-09", end: null, current: true, items: [] }],
  });

  it("accepte un profil cohérent", () => {
    expect(validationProblems(base())).toEqual([]);
  });

  it("refuse une compétence maîtrisée sans preuve, une preuve inconnue et des dates incohérentes", () => {
    const p = base();
    p.skills = [
      { id: "skl-0001", name: "Python", level: "mastered", evidence: [] },
      { id: "skl-0002", name: "SQL", level: "occasional", evidence: ["inconnu1"] },
      { id: "skl-0003", name: "Rust", level: "unconfirmed", evidence: [] },
    ];
    p.experiences.push({ id: "exp-0002", title: "Stage", company: "X", location: null, start: "2022-05", end: "2021-01", current: false, items: [] });
    expect(validationProblems(p)).toEqual([
      "« Stage » : la date de fin précède la date de début.",
      "Compétence « Python » : un niveau autre que « non confirmée » exige au moins une preuve.",
      "Compétence « SQL » : preuve introuvable.",
    ]);
    expect(validationProblems({ ...p, identity: { ...p.identity, fullName: "" } })[0]).toBe("Renseigne ton nom.");
  });

  it("calcule la durée d'une expérience en mois", () => {
    expect(experienceMonths({ start: "2021-06", end: "2023-08", current: false })).toBe(27);
    expect(experienceMonths({ start: "2023-09", end: null, current: true }, new Date("2026-10-18"))).toBe(38);
    expect(experienceMonths({ start: null, end: null, current: false })).toBeNull();
  });
});

describe("lecture des CV", () => {
  it("lit un PDF", async () => {
    const file = await readCvFile(minimalPdf(["Camille Martin, Data Engineer a Lyon.", "Experience : Lumio, 30 pipelines Python et Airflow.", "Formation : Master Informatique."]));
    expect(file.extension).toBe("pdf");
    expect(file.text).toContain("Camille Martin");
  });

  it("lit un document Word", async () => {
    const doc = new Document({
      sections: [{ children: CV_TEXT.split("\n").map((line) => new Paragraph({ text: line, alignment: AlignmentType.LEFT })) }],
    });
    const file = await readCvFile(Buffer.from(await Packer.toBuffer(doc)));
    expect(file.extension).toBe("docx");
    expect(file.text).toContain("Migration de l'entrepôt vers BigQuery");
  });

  it("refuse un autre format", async () => {
    await expect(readCvFile(Buffer.from("Camille Martin ".repeat(20)))).rejects.toMatchObject({ reason: "unsupported_type" });
  });
});
