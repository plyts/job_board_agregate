import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { checkAdzuna, checkFranceTravail, keywordLogic, missingFields } from "@/modules/sources/check";
import { resetFranceTravailCache } from "@/modules/sources/connectors/france-travail";

const DESCRIPTION = "Vous développez des services Java et Spring Boot pour une équipe produit, avec revues de code et tests automatisés.";
const TOTALS: Record<string, number> = { developpeur: 120, java: 80, "developpeur,java": 30 };

describe("npm run sources:check : chaque hypothèse des connecteurs confrontée à l'API", () => {
  let server: Server;
  let base = "";
  let ftFormat: "attendu" | "change" = "attendu";

  beforeAll(async () => {
    server = createServer((rq, rs) => {
      const url = new URL(rq.url!, "http://x");
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        rs.writeHead(status, { "content-type": "application/json", ...headers });
        rs.end(JSON.stringify(body));
      };
      rq.resume();
      rq.on("end", () => {
        if (url.pathname === "/token") return json(200, { access_token: "jeton", expires_in: 1499 });
        if (url.pathname === "/ft/referentiel/communes") return json(200, [{ code: "69383", libelle: "LYON 03", codePostal: "69003" }]);
        if (url.pathname === "/ft/offres/search") {
          if (url.searchParams.get("natureContrat") === "E2,FS") return json(400, { message: "natureContrat inconnu" });
          const total = TOTALS[url.searchParams.get("motsCles") ?? ""] ?? 500;
          const offer =
            ftFormat === "attendu"
              ? { id: "1", intitule: "Développeur Java", description: DESCRIPTION, dateCreation: "2026-10-18T08:00:00Z", lieuTravail: { libelle: "69 - LYON" }, entreprise: { nom: "Nordwave" }, typeContratLibelle: "CDI", origineOffre: { urlOrigine: "https://exemple.fr/1" } }
              : { identifiant: "1", titre: "Développeur Java" };
          return json(206, { resultats: [offer] }, { "content-range": `offres 0-0/${total}` });
        }
        if (url.pathname === "/adzuna/search/1") {
          const counts: Record<string, number> = { developpeur: 900, java: 400, "developpeur java": 1100 };
          return json(200, {
            count: counts[url.searchParams.get("what") ?? ""] ?? 0,
            results: [{ id: "A1", title: "Développeur", description: "Extrait…", redirect_url: "https://www.adzuna.fr/land/ad/A1", created: "2026-10-18T07:00:00Z", company: { display_name: "Lumio" }, location: { display_name: "Lyon" } }],
          });
        }
        json(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  beforeEach(() => {
    resetFranceTravailCache();
    ftFormat = "attendu";
  });
  afterAll(() => void server.close());

  it("déduit la combinaison des mots-clés des totaux et repère les champs absents", () => {
    expect(keywordLogic(120, 80, 30)).toBe("et");
    expect(keywordLogic(120, 80, 170)).toBe("ou");
    expect(keywordLogic(10, 10, 10)).toBe("indéterminé");
    expect(missingFields([{ a: { b: "x" }, c: "" }], ["a.b", "c", "d"])).toEqual(["c", "d"]);
  });

  it("France Travail : format conforme, mots-clés en « et », codes postaux ; un paramètre refusé est signalé", { timeout: 30_000 }, async () => {
    const lines = await checkFranceTravail({ clientId: "c", clientSecret: "s" }, { tokenUrl: `${base}/token`, apiUrl: `${base}/ft` });
    const byLabel = Object.fromEntries(lines.map((l) => [l.label, l]));
    expect(byLabel["Jeton OAuth2"]!.level).toBe("ok");
    expect(byLabel["Format des offres"]).toMatchObject({ level: "ok", detail: expect.stringContaining("1 normalisées") });
    expect(byLabel["Mots-clés séparés par des virgules"]).toMatchObject({ level: "ok", detail: expect.stringContaining("combinés en « et »") });
    expect(byLabel["Référentiel des communes"]).toMatchObject({ level: "ok", detail: "1 communes, 1 avec code postal" });
    expect(byLabel["Alternance (natureContrat=E2,FS)"]).toMatchObject({ level: "fail", detail: expect.stringContaining("400") });
    expect(byLabel["Département (departement=69)"]!.level).toBe("ok");
  });

  it("France Travail : un format d'offre différent est signalé, champ par champ", { timeout: 30_000 }, async () => {
    ftFormat = "change";
    const lines = await checkFranceTravail({ clientId: "c", clientSecret: "s" }, { tokenUrl: `${base}/token`, apiUrl: `${base}/ft` });
    expect(lines.find((l) => l.label === "Format des offres")).toMatchObject({ level: "warn", detail: expect.stringContaining("champs absents : id, intitule") });
  });

  it("Adzuna : format conforme ; des mots combinés en « ou » sont signalés", { timeout: 30_000 }, async () => {
    const lines = await checkAdzuna({ appId: "a", appKey: "k" }, `${base}/adzuna`);
    expect(lines.find((l) => l.label === "Format des offres")!.level).toBe("ok");
    expect(lines.find((l) => l.label === "Plusieurs mots dans « what »")).toMatchObject({ level: "warn", detail: expect.stringContaining("« ou »") });
    expect(lines.filter((l) => l.level === "fail")).toEqual([]);
  });
});
