import { createServer, type Server } from "node:http";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { jobOffers, jobSources } from "@/db/schema";
import { createUser } from "@/modules/identity";
import { ingestOffer, type IncomingOffer } from "@/modules/offers";
import { LocalFsStorage } from "@/modules/platform/storage";
import { resetFranceTravailCache } from "@/modules/sources/connectors/france-travail";
import { connectFranceTravail, createSavedSearch, runCombinedSearch, runSavedSearch, setSourceActive, type SourcesDeps } from "@/modules/sources";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const DESCRIPTION = "Vous préparez les commandes, contrôlez les expéditions et tenez les stocks à jour dans un entrepôt moderne de la métropole.";

function ftOffer(id: string, title: string, extra: Record<string, unknown> = {}) {
  return { id, intitule: title, description: DESCRIPTION, dateCreation: "2026-10-17T08:00:00Z", lieuTravail: { libelle: "69 - LYON 03" }, entreprise: { nom: "Adecco" }, ...extra };
}

function alert(url: string, title: string, extra: Partial<IncomingOffer> = {}): IncomingOffer {
  return { origin: "email_alert", board: "hellowork", externalId: url.split("/").pop()!, url, title, company: "Adecco", location: "Lyon", publishedAt: null, text: `${title} — extrait de l'alerte`, complete: false, ...extra };
}

describe("sources : défauts corrigés (dédoublonnage, plafond, pause)", { timeout: 30_000 }, async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const queued: string[] = [];
  let results: unknown[] = [];
  let onSearch: (() => Promise<void>) | null = null;
  let server: Server;
  let deps: SourcesDeps;
  let userId = "";

  beforeAll(async () => {
    server = createServer((rq, rs) => {
      const url = new URL(rq.url!, "http://x");
      const json = (status: number, body: unknown, headers: Record<string, string> = {}) => {
        rs.writeHead(status, { "content-type": "application/json", ...headers });
        rs.end(JSON.stringify(body));
      };
      rq.resume();
      rq.on("end", async () => {
        if (url.pathname === "/token") return json(200, { access_token: "jeton", expires_in: 1499 });
        if (url.searchParams.get("range") === "0-0") return json(206, { resultats: [] }, { "content-range": "offres 0-0/0" });
        if (url.pathname === "/ft/offres/search") {
          await onSearch?.();
          return json(200, { resultats: results }, { "content-range": `offres 0-${results.length - 1}/${results.length}` });
        }
        json(404, {});
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as { port: number };
    const base = `http://127.0.0.1:${port}`;
    deps = {
      db,
      pool,
      storage: new LocalFsStorage("/tmp/jobpilot-sources-unused"),
      enqueueAnalysis: async (_tx, job) => void queued.push(job.offerId),
      endpoints: { franceTravail: { tokenUrl: `${base}/token`, apiUrl: `${base}/ft` } },
    };
  });

  beforeEach(async () => {
    await resetDb(db);
    resetFranceTravailCache();
    queued.length = 0;
    results = [];
    onSearch = null;
    userId = (await createUser(db, { email: "f@exemple.fr", displayName: "F", password: "un mot de passe solide" })).id;
    expect(await connectFranceTravail(deps, userId, { clientId: "c", clientSecret: "s" })).toMatchObject({ ok: true });
  });

  afterAll(async () => {
    server.close();
    await pool.end();
    await closeTestDb();
  });

  const userOffers = () => db.select().from(jobOffers).where(eq(jobOffers.userId, userId));

  it("rattache une alerte à l'offre France Travail qui l'annonçait chez un partenaire, dans les deux sens", async () => {
    const ft: IncomingOffer = { origin: "france_travail", board: "france_travail", externalId: "FT1", url: "https://candidat.francetravail.fr/offres/recherche/detail/FT1", relatedUrls: ["https://www.hellowork.com/fr-fr/emplois/111.html?utm_source=francetravail"], title: "Cariste H/F", company: null, location: "Lyon 03 (69)", publishedAt: null, text: DESCRIPTION, complete: true };
    // France Travail d'abord, puis l'alerte HelloWork : rattachée grâce à l'URL partenaire retenue.
    expect(await ingestOffer(deps, userId, ft)).toMatchObject({ kind: "created" });
    expect(await ingestOffer(deps, userId, alert("https://www.hellowork.com/fr-fr/emplois/111.html", "Cariste (H/F)", { company: null }))).toMatchObject({ kind: "duplicate" });
    // L'alerte d'abord, puis France Travail.
    expect(await ingestOffer(deps, userId, alert("https://www.hellowork.com/fr-fr/emplois/222.html", "Magasinier", { company: null }))).toMatchObject({ kind: "created" });
    expect(await ingestOffer(deps, userId, { ...ft, externalId: "FT2", url: "https://candidat.francetravail.fr/offres/recherche/detail/FT2", relatedUrls: ["https://www.hellowork.com/fr-fr/emplois/222.html"], title: "Magasinier H/F", text: `${DESCRIPTION} Poste de magasinier en équipe du matin.` })).toMatchObject({ kind: "duplicate", upgraded: true });
    expect(await userOffers()).toHaveLength(2);
  });

  it("garde distinctes deux annonces d'un même site au même intitulé, et deux villes à tiret", async () => {
    results = [ftOffer("M1", "Préparateur de commandes H/F"), ftOffer("M2", "Préparateur de commandes H/F")];
    const run = await runCombinedSearch(deps, userId, { keywords: "préparateur", location: null, radiusKm: null, contracts: [], publishedWithinDays: null, limit: 50 });
    expect(run.items).toHaveLength(2);
    expect(await ingestOffer(deps, userId, alert("https://www.hellowork.com/fr-fr/emplois/1.html", "Ingénieur DevOps", { company: "Orange", location: "Saint-Denis" }))).toMatchObject({ kind: "created" });
    expect(await ingestOffer(deps, userId, alert("https://www.hellowork.com/fr-fr/emplois/2.html", "Ingénieur DevOps", { company: "Orange", location: "Saint-Malo" }))).toMatchObject({ kind: "created" });
    // Le même intitulé sur un autre site reste rattaché.
    expect(await ingestOffer(deps, userId, { ...alert("https://www.meteojob.com/x-31234567.html", "Ingénieur DevOps H/F", { company: "Orange", location: "Saint-Denis (93)" }), board: "meteojob", externalId: "31234567" })).toMatchObject({ kind: "duplicate" });
  });

  it("le plafond d'une recherche enregistrée compte les créations et les offres complétées, pas les annonces républiées comme doublons", async () => {
    // Même intitulé, entreprise et ville il y a 120 jours : au-delà de la fenêtre de 90 jours, l'annonce républiée est nouvelle.
    await ingestOffer(deps, userId, alert("https://www.hellowork.com/fr-fr/emplois/9.html", "Cariste H/F"));
    await db.update(jobOffers).set({ createdAt: sql`now() - interval '120 days'` }).where(eq(jobOffers.userId, userId));
    // Un extrait récent, que France Travail va compléter.
    await ingestOffer(deps, userId, alert("https://www.hellowork.com/fr-fr/emplois/10.html", "Magasinier H/F"));
    results = [ftOffer("R1", "Cariste H/F"), ftOffer("N1", "Magasinier H/F", { dateCreation: "2026-10-16T08:00:00Z" }), ftOffer("N2", "Préparateur H/F", { dateCreation: "2026-10-15T08:00:00Z" })];
    const id = await createSavedSearch(db, userId, { name: "Logistique", keywords: "logistique", location: null, radiusKm: null, contracts: [], publishedWithinDays: 7, sourceIds: [], intervalHours: 6, maxPerRun: 1 });
    const first = await runSavedSearch(deps, userId, id);
    // R1 (annonce républiée) est créée et épuise le plafond : Magasinier n'est pas complété, Préparateur attend.
    expect(first).toMatchObject({ created: 1, duplicates: 1 });
    expect(first!.errors.join(" ")).toContain("1 offre au-delà du plafond de 1");
    expect(queued).toHaveLength(1);
    const magasinier = (await userOffers()).find((o) => o.title === "Magasinier H/F")!;
    expect(magasinier.status).toBe("incomplete");
    // Passage suivant : Magasinier complété (compte dans le plafond), Préparateur encore reporté.
    const second = await runSavedSearch(deps, userId, id);
    expect(second).toMatchObject({ created: 0 });
    expect(queued).toHaveLength(2);
    expect((await userOffers()).find((o) => o.id === magasinier.id)!.status).toBe("queued");
    expect(await userOffers()).toHaveLength(3);
  });

  it("une pause faite pendant une recherche n'est pas écrasée", async () => {
    results = [ftOffer("P1", "Cariste H/F")];
    const [source] = await db.select().from(jobSources).where(eq(jobSources.userId, userId));
    onSearch = async () => void (await setSourceActive(db, userId, source!.id, false));
    await runCombinedSearch(deps, userId, { keywords: "cariste", location: null, radiusKm: null, contracts: [], publishedWithinDays: null, limit: 50 });
    expect((await db.select().from(jobSources).where(eq(jobSources.id, source!.id)))[0]!.state).toBe("paused");
  });
});
