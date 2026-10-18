import { describe, expect, it } from "vitest";
import { detectPii, guessName, redactPii, sanitizeOutput, totalCount } from "@/modules/privacy/pii";
import { CV_TEXT } from "../helpers/fixtures";

const HEADER = `Jean-Pierre DUPONT
Développeur Full Stack
12 bis rue des Lilas, 69003 Lyon
jp.dupont@exemple.fr · 06 12 34 56 78 · linkedin.com/in/jpdupont · github.com/jpdupont
Né le 14/03/1990 · Nationalité : française · Marié, 2 enfants · RQTH
N° SS : 1 90 03 69 123 456 78 · IBAN FR76 3000 6000 0112 3456 7890 189

EXPÉRIENCE
Développeur — Acme (2019 – 2024)
- Refonte de l'API de paiement : 1,2 million de transactions par mois, latence divisée par 3.
- Encadrement de 4 développeurs ; Jean-Pierre a présenté le projet en interne.
Marie Curie Labs — Data analyst (2017 – 2019)`;

describe("masquage des données personnelles", () => {
  it("devine le nom dans l'en-tête sans prendre un intitulé de poste", () => {
    expect(guessName(HEADER)).toBe("Jean-Pierre DUPONT");
    expect(guessName(CV_TEXT)).toBe("Camille Martin");
    expect(guessName("Data Engineer Senior\nLyon")).toBeNull();
    expect(guessName("Camille Martin, Data Engineer a Lyon.\nLumio : 30 pipelines.")).toBe("Camille Martin");
  });

  it("ne prend pas les chiffres d'un identifiant ou du nonce d'un document encadré pour un numéro", () => {
    for (const nonce of ["3829104756123456", "a3829104756b1234", "1900369123456789"]) {
      const block = `<document kind="candidate_profile" id="${nonce}">\nData Engineer\n</document id="${nonce}">`;
      expect(redactPii(block)).toMatchObject({ text: block, counts: {} });
    }
    expect(redactPii("Réf. A1234567890B, tél. 06 12 34 56 78").text).toBe("Réf. A1234567890B, tél. [TÉLÉPHONE]");
  });

  it("traite un CV plus court que la zone d'en-tête", () => {
    expect(redactPii("Camille Martin\n69003 Lyon", { cv: true }).text).toBe("[CANDIDAT]\n[CODE POSTAL] Lyon");
    expect(redactPii("", { cv: true }).text).toBe("");
  });

  it("masque identité, coordonnées, adresse, naissance, famille, NIR, IBAN, liens et données sensibles", () => {
    const r = redactPii(HEADER, { cv: true });
    for (const leaked of ["DUPONT", "Jean-Pierre", "Lilas", "69003", "jp.dupont", "06 12 34 56 78", "linkedin", "github", "14/03/1990", "française", "Marié", "2 enfants", "RQTH", "1 90 03", "FR76"]) {
      expect(r.text).not.toContain(leaked);
    }
    expect(r.counts).toMatchObject({ name: 2, email: 1, phone: 1, address: 1, postal_code: 1, birth_date: 1, nationality: 1, family: 2, nir: 1, iban: 1, personal_link: 2, sensitive: 1 });
    expect(r.found).toEqual({ email: "jp.dupont@exemple.fr", phone: "06 12 34 56 78", name: "Jean-Pierre DUPONT" });
  });

  it("garde les faits professionnels : chiffres, dates de poste, ville, entreprises", () => {
    const r = redactPii(HEADER, { cv: true });
    expect(r.text).toContain("Lyon");
    expect(r.text).toContain("1,2 million de transactions par mois, latence divisée par 3");
    expect(r.text).toContain("Encadrement de 4 développeurs");
    expect(r.text).toContain("(2019 – 2024)");
    expect(r.text).toContain("Marie Curie Labs");
    const plain = redactPii(CV_TEXT, { cv: true });
    expect(plain.text).toContain("30 pipelines Python/SQL");
    expect(plain.text).toContain("Université de Lyon — 2021");
    expect(plain.counts).toEqual({ name: 1, email: 1, phone: 1 });
  });

  it("inspecte et nettoie une réponse de modèle", () => {
    expect(totalCount(detectPii("Profil solide, 5 ans d'expérience."))).toBe(0);
    const { value, counts } = sanitizeOutput({ summary: "Contactez Camille Martin au 06 98 76 54 32", items: ["Python", "jp@ex.fr"] }, { names: ["Camille Martin"] });
    expect(value).toEqual({ summary: "Contactez [CANDIDAT] au [TÉLÉPHONE]", items: ["Python", "[E-MAIL]"] });
    expect(counts).toEqual({ name: 1, phone: 1, email: 1 });
  });
});
