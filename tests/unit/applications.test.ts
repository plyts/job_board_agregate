import { describe, expect, it } from "vitest";
import { addDays, ALREADY_SENT, initialStatus, isOverdue, localDate, moveRefusal, SEND_REQUIRED } from "@/modules/applications/rules";
import { guardLetter, letterText } from "@/modules/applications/letter";
import { sniffDocument } from "@/modules/applications/service";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT } from "../helpers/fixtures";

describe("règles des candidatures", () => {
  it("n'atteint « Envoyée » et la suite qu'après confirmation d'envoi", () => {
    expect(moveRefusal("sent", false)).toBe(SEND_REQUIRED);
    expect(moveRefusal("hr_interview", false)).toBe(SEND_REQUIRED);
    expect(moveRefusal("rejected", false)).toBeNull();
    expect(moveRefusal("cv_to_adapt", false)).toBeNull();
    expect(moveRefusal("followed_up", true)).toBeNull();
    expect(moveRefusal("ready", true)).toBe(ALREADY_SENT);
    expect(moveRefusal("abandoned", true)).toBeNull();
  });

  it("place une nouvelle candidature selon l'état réel de l'offre et du CV", () => {
    expect(initialStatus("analyzed", true, true)).toBe("ready");
    expect(initialStatus("failed", false, false)).toBe("to_analyze");
    expect(initialStatus("analyzed", false, true)).toBe("cv_to_adapt");
    expect(initialStatus("qualified", false, false)).toBe("qualified");
    expect(initialStatus("analyzed", false, false)).toBe("new_offer");
  });

  it("calcule les dates dans le fuseau de l'utilisateur", () => {
    expect(localDate(new Date("2026-10-18T23:30:00Z"), "Europe/Paris")).toBe("2026-10-19");
    expect(localDate(new Date("2026-10-18T23:30:00Z"), "UTC")).toBe("2026-10-18");
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
    expect(isOverdue("2026-10-17", "2026-10-18")).toBe(true);
    expect(isOverdue("2026-10-18", "2026-10-18")).toBe(false);
    expect(isOverdue(null, "2026-10-18")).toBe(false);
  });

  it("reconnaît le type du fichier envoyé par sa signature", () => {
    expect(sniffDocument(Buffer.from("%PDF-1.7\n"))?.extension).toBe("pdf");
    expect(sniffDocument(Buffer.from("PK\u0003\u0004rest", "latin1"))?.extension).toBe("docx");
    expect(sniffDocument(Buffer.from("<html>"))).toBeNull();
  });
});

describe("proposition de lettre", () => {
  const { content: profile } = toProfileContent(CV_EXTRACTION, CV_TEXT, { email: null, phone: null });
  const item = profile.experiences[0]!.items[0]!.id;

  it("écarte un paragraphe de fond sans source, signale une donnée masquée et ne reprend que les paragraphes sans signalement", () => {
    const { paragraphs, dropped } = guardLetter(
      {
        paragraphs: [
          { kind: "opening", text: "  Votre plateforme de données m'intéresse.  ", sourceIds: [], covers: [] },
          { kind: "body", text: "Je suis motivé.", sourceIds: ["absent"], covers: [] },
          { kind: "body", text: "Chez Lumio, 30 pipelines Python/SQL orchestrés par Airflow.", sourceIds: [item], covers: ["Python et SQL"] },
          { kind: "closing", text: "Écrivez-moi à [E-MAIL]. [CANDIDAT]", sourceIds: [], covers: [] },
        ],
      },
      profile,
      [],
      "Camille Martin",
    );
    expect(dropped).toBe(1);
    expect(paragraphs.map((p) => p.issues.length)).toEqual([0, 0, 1]);
    expect(paragraphs[2]).toMatchObject({ text: "Écrivez-moi à [E-MAIL]. Camille Martin", issues: ["contient une donnée masquée (adresse e-mail)."] });
    expect(letterText({ paragraphs, dropped, promptVersion: "v", llmCallId: "c", createdAt: "" })).toBe(
      "Votre plateforme de données m'intéresse.\n\nChez Lumio, 30 pipelines Python/SQL orchestrés par Airflow.",
    );
  });
});
