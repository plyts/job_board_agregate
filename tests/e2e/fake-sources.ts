import { createServer, type Server } from "node:http";

/** Port du faux serveur des API de sources pendant les tests e2e (France Travail, Adzuna). */
export const FAKE_SOURCES_PORT = Number(process.env.FAKE_SOURCES_PORT ?? 3199);

const DESCRIPTION = "Vous concevez et maintenez des pipelines de données en Python et SQL pour des clients industriels, avec Airflow et BigQuery.";

/** Imite l'API France Travail (jeton OAuth2, recherche) et Adzuna, avec des identifiants de test. */
export function startFakeSources(port = FAKE_SOURCES_PORT): Promise<Server> {
  const server = createServer((rq, rs) => {
    const url = new URL(rq.url!, "http://x");
    const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      rs.writeHead(status, { "content-type": "application/json", ...headers });
      rs.end(JSON.stringify(body));
    };
    let body = "";
    rq.on("data", (c) => (body += c));
    rq.on("end", () => {
      if (url.pathname === "/token") {
        if (new URLSearchParams(body).get("client_id") !== "client-e2e") return json(401, { error: "invalid_client" });
        return json(200, { access_token: "jeton-e2e", expires_in: 1499 });
      }
      if (url.pathname.startsWith("/ft/")) {
        if (rq.headers.authorization !== "Bearer jeton-e2e") return json(401, {});
        if (url.pathname === "/ft/referentiel/communes") return json(200, [{ code: "69123", libelle: "LYON" }]);
        return json(
          200,
          {
            resultats: [
              { id: "E2E1", intitule: "Ingénieur données (H/F)", description: DESCRIPTION, dateCreation: "2026-10-18T08:00:00Z", lieuTravail: { libelle: "69 - LYON" }, entreprise: { nom: "Lumio Data" } },
              { id: "E2E2", intitule: "Data Engineer junior", description: "Poste en alternance, détails à venir.", dateCreation: "2026-10-17T08:00:00Z", lieuTravail: { libelle: "69 - VILLEURBANNE" }, entreprise: { nom: "Sencia" } },
            ],
          },
          { "content-range": "offres 0-1/2" },
        );
      }
      if (url.pathname.startsWith("/adzuna/")) return json(401, {});
      json(404, {});
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}
