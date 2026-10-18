import { describe, expect, it } from "vitest";
import { addDays, ALREADY_SENT, initialStatus, isOverdue, localDate, moveRefusal, SEND_REQUIRED } from "@/modules/applications/rules";
import { sniffDocument } from "@/modules/applications/service";

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
