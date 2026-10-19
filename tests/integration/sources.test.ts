import { createServer, type Server } from "node:http";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { jobOffers, jobSources, offerImports, offerSightings, syncRuns } from "@/db/schema";
import { strFromU8, unzipSync } from "fflate";
import { exportAccount } from "@/modules/account/service";
import { createUser } from "@/modules/identity";
import { completeOfferText } from "@/modules/offers";
import { LocalFsStorage } from "@/modules/platform/storage";
import { resetFranceTravailCache } from "@/modules/sources/connectors/france-travail";
import {
  connectAdzuna,
  connectCareerPage,
  connectFranceTravail,
  createSavedSearch,
  dueWork,
  importSearchResults,
  listSources,
  purgeSearchRuns,
  runCombinedSearch,
  runSavedSearch,
  sightingsOf,
  type SourcesDeps,
} from "@/modules/sources";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const DESCRIPTION = "Vous concevez et maintenez des pipelines de données en Python et SQL pour des clients industriels, avec Airflow et BigQuery.";

function ftOffer(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, intitule: title, description: DESCRIPTION, dateCreation: "2026-10-17T08:00:00Z", lieuTravail: { libelle: "69 - LYON" }, entreprise: { nom: "Nordwave" }, ...extra };
}

describe("sources connectées : recherche combinée, import, recherches enregistrées", { timeout: 30_000 }, async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const queued: string[] = [];
  const calls: string[] = [];
  let server: Server;
  let base = "";
  let deps: SourcesDeps;
  let userId = "";

  beforeAll(async () => {
    server = createServer((rq, rs) => {
      const url = new URL(rq.url!, "http://x");
      calls.push(`${rq.method} ${url.pathname}${url.search}`);
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        rs.writeHead(status, { "content-type": "application/json", ...headers });
        rs.end(JSON.stringify(body));
      };
      let body = "";
      rq.on("data", (c) => (body += c));
      rq.on("end", () => {
        if (url.pathname === "/token") {
          const form = new URLSearchParams(body);
          if (form.get("client_id") !== "bon-client" || form.get("scope") !== "api_offresdemploiv2 o2dsoffre") return json(401, { error: "invalid_client" });
          return json(200, { access_token: "jeton", expires_in: 1499, token_type: "Bearer" });
        }
        if (url.pathname.startsWith("/ft/")) {
          if (rq.headers.authorization !== "Bearer jeton") return json(401, {});
          if (url.pathname === "/ft/referentiel/communes") return json(200, [{ code: "69123", libelle: "LYON" }]);
          if (url.searchParams.get("range") === "0-0") return json(206, { resultats: [ftOffer("FT0", "Test")] }, { "content-range": "offres 0-0/2" });
          return json(
            200,
            {
              resultats: [
                ftOffer("FT1", "Data Engineer (H/F)", { origineOffre: { urlOrigine: "https://www.hellowork.com/fr-fr/emplois/111.html" } }),
                ftOffer("FT2", "Analytics Engineer", { dateCreation: "2026-10-16T08:00:00Z" }),
              ],
            },
            { "content-range": "offres 0-1/2" },
          );
        }
        if (url.pathname === "/adzuna/search/1") {
          if (url.searchParams.get("app_key") !== "bonne-cle") return json(401, {});
          const what = (url.searchParams.get("what") ?? "").toLowerCase();
          return json(200, {
            count: 2,
            results: [
              { id: "A1", title: "Data Engineer H/F", description: "Extrait…", redirect_url: "https://www.adzuna.fr/land/ad/A1", created: "2026-10-17T07:00:00Z", company: { display_name: "Nordwave" }, location: { display_name: "Lyon" } },
              { id: "A2", title: "Product Owner Data", description: "Extrait PO…", redirect_url: "https://www.adzuna.fr/land/ad/A2", created: "2026-10-15T07:00:00Z", company: { display_name: "Lumio" }, location: { display_name: "Lyon" } },
            ].filter((j) => !what || what.split(" ").some((w) => j.title.toLowerCase().includes(w))),
          });
        }
        if (url.pathname === "/gh/v1/boards/nordwave/jobs") {
          return json(200, {
            jobs: [
              { id: 9, title: "Platform Engineer", absolute_url: "https://job-boards.greenhouse.io/nordwave/jobs/9", location: { name: "Lyon" }, updated_at: "2026-10-14T10:00:00Z", content: `&lt;p&gt;${DESCRIPTION} Kubernetes en production.&lt;/p&gt;` },
              { id: 10, title: "Office Manager", absolute_url: "https://job-boards.greenhouse.io/nordwave/jobs/10", location: { name: "Lyon" }, updated_at: "2026-10-14T10:00:00Z", content: "&lt;p&gt;Accueil et logistique.&lt;/p&gt;" },
            ],
          });
        }
        if (url.pathname === "/gh/v1/boards/inconnue/jobs") return json(404, {});
        json(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    base = `http://127.0.0.1:${port}`;
    deps = {
      db,
      pool,
      storage: new LocalFsStorage("/tmp/jobpilot-sources-unused"),
      enqueueAnalysis: async (_tx, job) => void queued.push(job.offerId),
      endpoints: { franceTravail: { tokenUrl: `${base}/token`, apiUrl: `${base}/ft` }, adzuna: `${base}/adzuna`, careerPages: { greenhouse: `${base}/gh` } },
    };
  });

  beforeEach(async () => {
    await resetDb(db);
    resetFranceTravailCache();
    queued.length = 0;
    calls.length = 0;
    userId = (await createUser(db, { email: "s@exemple.fr", displayName: "S", password: "un mot de passe solide" })).id;
  });

  afterAll(async () => {
    server.close();
    await pool.end();
    await closeTestDb();
  });

  async function connectAll() {
    expect(await connectFranceTravail(deps, userId, { clientId: "bon-client", clientSecret: "secret-ft" })).toMatchObject({ ok: true });
    expect(await connectAdzuna(deps, userId, { appId: "app", appKey: "bonne-cle" })).toMatchObject({ ok: true });
    expect(await connectCareerPage(deps, userId, { url: "https://job-boards.greenhouse.io/nordwave", company: "Nordwave" })).toMatchObject({ ok: true });
  }

  it("teste chaque connexion avant de l'enregistrer et ne stocke les identifiants que chiffrés", async () => {
    expect(await connectFranceTravail(deps, userId, { clientId: "mauvais", clientSecret: "x" })).toEqual({ ok: false, error: expect.stringContaining("refuse") });
    expect(await connectAdzuna(deps, userId, { appId: "app", appKey: "fausse" })).toMatchObject({ ok: false });
    expect(await connectCareerPage(deps, userId, { url: "https://job-boards.greenhouse.io/inconnue", company: "" })).toMatchObject({ ok: false, error: expect.stringContaining("introuvable") });
    expect(await connectCareerPage(deps, userId, { url: "https://www.nordwave.fr/carrieres", company: "" })).toMatchObject({ ok: false, error: expect.stringContaining("non reconnue") });
    await connectAll();
    const rows = await db.select().from(jobSources).where(eq(jobSources.userId, userId));
    expect(rows.map((r) => r.key).sort()).toEqual(["adzuna", "france_travail", "greenhouse:nordwave"]);
    expect(JSON.stringify(rows)).not.toContain("secret-ft");
    expect(JSON.stringify(rows)).not.toContain("bonne-cle");
    expect((await listSources(db, userId)).every((s) => !("secret" in s))).toBe(true);
    // L'export du compte liste les sources sans leurs identifiants, même chiffrés.
    const zip = unzipSync(await exportAccount({ db, storage: deps.storage }, userId));
    const exported = strFromU8(zip["donnees.json"]!);
    expect(JSON.parse(exported).sources).toHaveLength(3);
    expect(exported).not.toContain("secret-ft");
    expect(exported).not.toMatch(/"secret":/);
  });

  it("recherche sur toutes les sources, fusionne la même offre vue deux fois et importe : texte complet en analyse, extrait à compléter", async () => {
    await connectAll();
    const run = await runCombinedSearch(deps, userId, { keywords: "engineer", location: "Lyon", radiusKm: 10, contracts: ["CDI"], publishedWithinDays: 7, limit: 50 });
    expect(run.errors).toEqual([]);
    expect(run.sources).toBe(3);
    expect(calls.some((c) => c.startsWith("GET /ft/offres/search?") && c.includes("commune=69123") && c.includes("distance=10") && c.includes("typeContrat=CDI"))).toBe(true);
    // FT1 et A1 : même intitulé, même entreprise, même ville → une seule ligne, texte complet de France Travail.
    const titles = run.items.map((i) => [i.offer.title, i.boards.join("+")]);
    expect(titles).toEqual([
      ["Data Engineer (H/F)", "france_travail+adzuna"],
      ["Analytics Engineer", "france_travail"],
      ["Platform Engineer", "greenhouse"],
    ]);

    const summary = await importSearchResults(deps, userId, run.runId, [0, 1, 2]);
    expect(summary).toEqual({ created: 3, duplicates: 0, incomplete: 0, skipped: 0 });
    expect(queued).toHaveLength(3);
    const offers = await db.select().from(jobOffers).where(eq(jobOffers.userId, userId));
    expect(offers.map((o) => [o.source, o.status]).sort()).toEqual([
      ["career_page", "queued"],
      ["france_travail", "queued"],
      ["france_travail", "queued"],
    ]);

    // Une nouvelle recherche signale les offres déjà importées.
    const again = await runCombinedSearch(deps, userId, { keywords: "engineer", location: null, radiusKm: null, contracts: [], publishedWithinDays: null, limit: 50 });
    expect(again.items.filter((i) => i.existingOfferId).map((i) => i.offer.title)).toEqual(["Data Engineer (H/F)", "Analytics Engineer", "Platform Engineer"]);

    // L'annonce Adzuna (extrait) importée seule est rattachée à l'offre France Travail existante.
    const adzunaOnly = await runCombinedSearch(deps, userId, { keywords: "data", location: null, radiusKm: null, contracts: [], publishedWithinDays: null, limit: 50 }, [
      (await listSources(db, userId)).find((s) => s.kind === "adzuna")!.id,
    ]);
    const po = adzunaOnly.items.findIndex((i) => i.offer.title === "Product Owner Data");
    const de = adzunaOnly.items.findIndex((i) => i.offer.title === "Data Engineer H/F");
    expect(await importSearchResults(deps, userId, adzunaOnly.runId, [po, de])).toEqual({ created: 1, duplicates: 1, incomplete: 1, skipped: 0 });
    const ft1 = offers.find((o) => o.title === "Data Engineer (H/F)")!;
    expect((await sightingsOf(db, userId, ft1.id)).map((s) => s.board)).toEqual(["france_travail", "adzuna"]);
    const [poOffer] = await db.select().from(jobOffers).where(eq(jobOffers.title, "Product Owner Data"));
    expect(poOffer).toMatchObject({ source: "adzuna", status: "incomplete" });

    // Texte collé : l'offre part en analyse.
    expect(await completeOfferText(deps, userId, poOffer!.id, "trop court")).toMatchObject({ ok: false });
    expect(await completeOfferText(deps, userId, poOffer!.id, `Product Owner Data chez Lumio. ${DESCRIPTION} Vous animez le backlog.`)).toEqual({ ok: true });
    expect((await db.select().from(jobOffers).where(eq(jobOffers.id, poOffer!.id)))[0]!.status).toBe("queued");
  });

  it("exécute une recherche enregistrée avec plafond, puis ne réimporte pas les mêmes offres", async () => {
    await connectAll();
    const id = await createSavedSearch(db, userId, { name: "Data Lyon", keywords: "engineer", location: null, radiusKm: null, contracts: [], publishedWithinDays: 7, sourceIds: [], intervalHours: 6, maxPerRun: 2 });
    expect((await dueWork(db)).searches.map((s) => s.searchId)).toEqual([id]);
    const first = await runSavedSearch(deps, userId, id, new Date("2026-10-18T10:00:00Z"));
    expect(first).toMatchObject({ status: "ok", created: 2 });
    expect(first!.errors.join(" ")).toContain("au-delà du plafond de 2");
    expect((await dueWork(db, new Date("2026-10-18T12:00:00Z"))).searches).toEqual([]);
    expect((await dueWork(db, new Date("2026-10-18T16:30:00Z"))).searches).toHaveLength(1);
    const second = await runSavedSearch(deps, userId, id, new Date("2026-10-18T16:30:00Z"));
    expect(second).toMatchObject({ created: 1 });
    const third = await runSavedSearch(deps, userId, id, new Date("2026-10-18T23:00:00Z"));
    // Data Engineer (France Travail + Adzuna fusionnés), Analytics Engineer, Platform Engineer.
    expect(third).toMatchObject({ created: 0, duplicates: 3 });
    expect(await db.select().from(jobOffers).where(eq(jobOffers.userId, userId))).toHaveLength(3);
    // Le doublon Adzuna est rattaché une fois ; revoir une offre sur la même source n'ajoute pas de doublon.
    const dupRows = await db.select().from(offerImports).where(eq(offerImports.outcome, "duplicate"));
    expect(dupRows).toHaveLength(1);
    expect((await db.select().from(offerSightings)).map((s) => s.board).sort()).toEqual(["adzuna", "france_travail", "france_travail", "greenhouse"]);
    expect((await db.select().from(syncRuns).where(eq(syncRuns.savedSearchId, id))).length).toBe(3);
  });

  it("une source en échec n'empêche pas les autres de répondre", async () => {
    await connectAll();
    await db.update(jobSources).set({ config: { page: { provider: "greenhouse", token: "inconnue" }, company: null } }).where(eq(jobSources.key, "greenhouse:nordwave"));
    const run = await runCombinedSearch(deps, userId, { keywords: "engineer", location: null, radiusKm: null, contracts: [], publishedWithinDays: null, limit: 50 });
    expect(run.errors).toEqual([expect.stringContaining("Nordwave · Greenhouse : ")]);
    expect(run.items.length).toBeGreaterThan(0);
    const [gh] = await db.select().from(jobSources).where(eq(jobSources.key, "greenhouse:nordwave"));
    expect(gh!.lastError).toContain("introuvable");
    // Les recherches ponctuelles sont effacées après 30 jours.
    expect(await purgeSearchRuns(db, 30, new Date(Date.now() + 31 * 24 * 60 * 60 * 1000))).toBe(1);
  });
});
