import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { jobOffers, offerImports } from "@/db/schema";
import { createUser } from "@/modules/identity";
import { getOffer, importOffer, listOffers, type OfferDeps } from "@/modules/offers";
import { LocalFsStorage } from "@/modules/platform/storage";
import { minimalPdf } from "../helpers/pdf";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const OFFER_TEXT = `Senior Data Engineer — Nordwave
Lyon, hybride (3 jours sur site).
Vos missions : concevoir et maintenir des pipelines batch et temps réel, industrialiser les traitements sous Airflow.
Profil : au moins 5 ans d'expérience, maîtrise de Python et SQL, expérience de Spark et de GCP (BigQuery).`;

const JSON_LD_PAGE = `<html><head><script type="application/ld+json">${JSON.stringify({
  "@type": "JobPosting",
  title: "Analytics Engineer",
  description: "<p>Rejoignez l'équipe data de Vélia à Nantes. Vous modéliserez les données avec dbt et BigQuery, et accompagnerez les équipes produit dans leurs analyses quotidiennes.</p>",
  hiringOrganization: { name: "Vélia" },
  jobLocation: { address: { addressLocality: "Nantes" } },
  datePosted: "2026-10-17",
})}</script></head><body></body></html>`;

describe("import d'offres", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const storageRoot = await mkdtemp(path.join(tmpdir(), "jobpilot-offers-"));
  let server: Server;
  let base = "";
  let fetches: string[] = [];
  let enqueued: string[] = [];
  let userId = "";

  const deps = (overrides: Partial<OfferDeps> = {}): OfferDeps => ({
    db,
    pool,
    storage: new LocalFsStorage(storageRoot),
    enqueueAnalysis: async (_tx, job) => {
      enqueued.push(job.offerId);
    },
    // Serveur de test local : seules ces options l'autorisent, jamais la configuration par défaut.
    fetchOptions: { isAllowedAddress: () => true, allowAnyPort: true },
    ...overrides,
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      fetches.push(req.url ?? "");
      if (req.url === "/robots.txt") {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("User-agent: *\nDisallow: /prive/\n");
      }
      if (req.url?.startsWith("/offre/velia")) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return res.end(JSON_LD_PAGE);
      }
      if (req.url === "/redirige") {
        res.writeHead(302, { location: "/offre/velia" });
        return res.end();
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.close();
    await pool.end();
    await rm(storageRoot, { recursive: true, force: true });
    await closeTestDb();
  });

  beforeEach(async () => {
    await resetDb(db);
    fetches = [];
    enqueued = [];
    userId = (await createUser(db, { email: "o@exemple.fr", displayName: "O", password: "un mot de passe solide" })).id;
  });

  it("crée une offre à partir d'un texte collé et met son analyse en file", async () => {
    const result = await importOffer(deps(), userId, { kind: "text", text: OFFER_TEXT, url: "https://exemple.fr/jobs/1?utm_source=mail" });
    expect(result).toMatchObject({ ok: true, duplicate: false });
    if (!result.ok) return;
    const offer = await getOffer(db, userId, result.offerId);
    expect(offer).toMatchObject({ source: "text", status: "queued", title: "Senior Data Engineer — Nordwave", canonicalUrl: "https://exemple.fr/jobs/1" });
    expect(offer?.originalUrl).toBe("https://exemple.fr/jobs/1?utm_source=mail");
    expect(enqueued).toEqual([result.offerId]);
    const imports = await db.select().from(offerImports);
    expect(imports.map((i) => i.outcome)).toEqual(["created"]);
  });

  it("reconnaît un doublon reformaté sans relancer d'analyse", async () => {
    const first = await importOffer(deps(), userId, { kind: "text", text: OFFER_TEXT });
    const second = await importOffer(deps(), userId, { kind: "text", text: `  ${OFFER_TEXT.toUpperCase().replace(/\n/g, "\n\n")}  ` });
    expect(second).toEqual({ ok: true, duplicate: true, offerId: first.ok ? first.offerId : "" });
    expect(await db.select().from(jobOffers)).toHaveLength(1);
    expect(enqueued).toHaveLength(1);
    expect((await db.select().from(offerImports)).map((i) => i.outcome).sort()).toEqual(["created", "duplicate"]);
  });

  it("récupère une page autorisée et exploite son annonce structurée, redirection comprise", async () => {
    const result = await importOffer(deps(), userId, { kind: "url", url: `${base}/redirige` });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offer = await getOffer(db, userId, result.offerId);
    expect(offer).toMatchObject({ source: "url", title: "Analytics Engineer", company: "Vélia", location: "Nantes" });
    expect(fetches).toEqual(["/robots.txt", "/redirige", "/offre/velia"]);
  });

  it("ne récupère pas une URL déjà importée (paramètres de suivi ignorés)", async () => {
    await importOffer(deps(), userId, { kind: "url", url: `${base}/offre/velia` });
    fetches = [];
    const again = await importOffer(deps(), userId, { kind: "url", url: `${base}/offre/velia?utm_campaign=alerte` });
    expect(again).toMatchObject({ ok: true, duplicate: true });
    expect(fetches).toEqual([]);
  });

  it("respecte robots.txt et propose de coller le texte", async () => {
    const result = await importOffer(deps(), userId, { kind: "url", url: `${base}/prive/offre` });
    expect(result).toMatchObject({ ok: false, code: "FETCH_NOT_ALLOWED" });
    expect(fetches).toEqual(["/robots.txt"]);
    expect(await db.select().from(jobOffers)).toHaveLength(0);
  });

  it("refuse par défaut toute adresse interne", async () => {
    const result = await importOffer(deps({ fetchOptions: undefined }), userId, { kind: "url", url: `${base}/offre/velia` });
    expect(result).toMatchObject({ ok: false, code: "FETCH_NOT_ALLOWED" });
    expect(fetches).toEqual([]);
    const meta = await importOffer(deps({ fetchOptions: undefined }), userId, { kind: "url", url: "http://169.254.169.254/latest/meta-data" });
    expect(meta).toMatchObject({ ok: false, code: "FETCH_NOT_ALLOWED" });
  });

  it("refuse les domaines dont les conditions interdisent la collecte", async () => {
    const result = await importOffer(deps(), userId, { kind: "url", url: "https://www.linkedin.com/jobs/view/123" });
    expect(result).toMatchObject({ ok: false, code: "FETCH_NOT_ALLOWED" });
  });

  it("importe un PDF et conserve le fichier d'origine", async () => {
    const pdf = minimalPdf(["Data Engineer GCP chez Ondine Data a Lyon.", "Missions : pipelines Python, Airflow, BigQuery.", "Profil : 3 ans d'experience minimum en ingenierie des donnees."]);
    const result = await importOffer(deps(), userId, { kind: "file", bytes: pdf });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const offer = await getOffer(db, userId, result.offerId);
    expect(offer?.sourceFileKey).toMatch(new RegExp(`^${userId}/offers/[0-9a-f-]+\\.pdf$`));
    const stored = await new LocalFsStorage(storageRoot).get(offer!.sourceFileKey!);
    expect(stored.equals(pdf)).toBe(true);
  });

  it("rejette un texte trop court", async () => {
    expect(await importOffer(deps(), userId, { kind: "text", text: "Data Engineer" })).toMatchObject({ ok: false, code: "TEXT_TOO_SHORT" });
  });

  it("annule la création si la mise en file échoue", async () => {
    const failing = deps({
      enqueueAnalysis: async () => {
        throw new Error("file indisponible");
      },
    });
    await expect(importOffer(failing, userId, { kind: "text", text: OFFER_TEXT })).rejects.toThrow("file indisponible");
    expect(await db.select().from(jobOffers)).toHaveLength(0);
    expect(await db.select().from(offerImports)).toHaveLength(0);
  });

  it("isole les offres de chaque utilisateur", async () => {
    const other = (await createUser(db, { email: "autre@exemple.fr", displayName: "A", password: "un mot de passe solide" })).id;
    const mine = await importOffer(deps(), userId, { kind: "text", text: OFFER_TEXT });
    if (!mine.ok) throw new Error("import attendu");
    expect(await getOffer(db, other, mine.offerId)).toBeNull();
    expect(await listOffers(db, other)).toHaveLength(0);
    // La même annonce n'est pas un doublon pour un autre utilisateur.
    expect(await importOffer(deps(), other, { kind: "text", text: OFFER_TEXT })).toMatchObject({ ok: true, duplicate: false });
    expect(await getOffer(db, userId, "pas-un-uuid")).toBeNull();
  });

  it("filtre la liste par texte et par statut", async () => {
    await importOffer(deps(), userId, { kind: "text", text: OFFER_TEXT });
    await importOffer(deps(), userId, { kind: "url", url: `${base}/offre/velia` });
    expect((await listOffers(db, userId)).map((o) => o.title)).toEqual(["Analytics Engineer", "Senior Data Engineer — Nordwave"]);
    expect((await listOffers(db, userId, { q: "vélia" })).map((o) => o.title)).toEqual(["Analytics Engineer"]);
    expect(await listOffers(db, userId, { q: "100%_" })).toHaveLength(0);
    expect(await listOffers(db, userId, { status: "analyzed" })).toHaveLength(0);
    await db.update(jobOffers).set({ status: "analyzed" }).where(eq(jobOffers.title, "Analytics Engineer"));
    expect(await listOffers(db, userId, { status: "analyzed" })).toHaveLength(1);
  });
});
