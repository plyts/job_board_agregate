import { describe, expect, it } from "vitest";
import { cvFromProfile } from "@/modules/cv/content";
import { exportDocx, exportFileName, exportPdf, toWinAnsi } from "@/modules/cv/export";
import { readCvFile, toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";

const { content: profile } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: "camille@exemple.fr", phone: "06 12 34 56 78" });
const meta = { version: 3, company: "Nordwave Énergie", createdAt: new Date("2026-10-18T10:00:00Z") };

describe("export du CV", () => {
  const cv = cvFromProfile(profile);
  cv.experiences[0]!.items[0]!.text = "Conception de 30 pipelines Python/SQL sous Airflow — « production » ≥ 2023 → OK.";

  it("produit un PDF texte relisible, avec les coordonnées et les formulations du CV", async () => {
    const bytes = await exportPdf(cv, profile, meta);
    const { text, extension } = await readCvFile(Buffer.from(bytes));
    expect(extension).toBe("pdf");
    expect(text).toContain("Camille Martin");
    expect(text).toContain("camille@exemple.fr");
    expect(text).toContain("Data Engineer — Lumio");
    expect(text).toContain("« production » >= 2023 -> OK.");
    expect(text).toContain("EXPÉRIENCE PROFESSIONNELLE");
  });

  it("donne le même fichier PDF pour la même version", async () => {
    const a = Buffer.from(await exportPdf(cv, profile, meta));
    const b = Buffer.from(await exportPdf(cv, profile, meta));
    expect(a.equals(b)).toBe(true);
  });

  it("produit un DOCX relisible", async () => {
    const { text, extension } = await readCvFile(await exportDocx(cv, profile, meta));
    expect(extension).toBe("docx");
    expect(text).toContain("Migration de l'entrepôt vers BigQuery, 4 To.");
    expect(text).toContain("06 12 34 56 78");
  });

  it("nomme le fichier sans accents ni espaces", () => {
    expect(exportFileName(profile, meta, "pdf")).toBe("CV-Camille-Martin-Nordwave-Energie-v3.pdf");
  });

  it("ramène le texte aux caractères codables par la police standard", () => {
    expect(toWinAnsi("Ł → ő ≥ 😀 « é » – •")).toBe("L -> o >= ? « é » – •");
  });
});
