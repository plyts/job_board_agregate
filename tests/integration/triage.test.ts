import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { jobOffers, matchAnalyses, offerAnalyses } from "@/db/schema";
import { analyzeOffer, decideOffer } from "@/modules/analysis";
import { createUser } from "@/modules/identity";
import { autoMatch, computeMatch, DEFAULT_WEIGHTS, listToTriage, requestMissingMatches, triageCounts, updateWeights } from "@/modules/matching";
import { importOffer, ingestOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LocalFsStorage } from "@/modules/platform/storage";
import { saveDraft, startDraft, validateDraft } from "@/modules/profile";
import { toProfileContent } from "@/modules/profile/extract";
import { CV_EXTRACTION, CV_TEXT, EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const NOW = new Date("2026-10-19T09:00:00Z");

describe("à traiter : matching automatique et offres classées par score", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const storage = new LocalFsStorage("/tmp/jobpilot-triage-unused");
  const enqueued: string[] = [];
  const deps = { db, pool, enqueueMatch: async (_tx: unknown, job: { matchId: string }) => void enqueued.push(job.matchId) };
  let userId = "";

  async function analyzed(suffix: string) {
    const imported = await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, userId, { kind: "text", text: `${OFFER_TEXT}\n${suffix}` });
    if (!imported.ok) throw new Error("import attendu");
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId: imported.offerId, userId });
    return imported.offerId;
  }

  async function validateProfile(extra = "") {
    const { content } = toProfileContent(CV_EXTRACTION, `${CV_TEXT}${extra}`, { email: "camille@exemple.fr", phone: null });
    await startDraft(db, userId);
    await saveDraft(db, userId, content);
    expect((await validateDraft(db, userId)).ok).toBe(true);
  }

  async function computeAll() {
    for (const matchId of enqueued.splice(0)) await computeMatch({ db, pool, llm: null, today: NOW }, { matchId, userId });
  }

  beforeEach(async () => {
    await resetDb(db);
    enqueued.length = 0;
    userId = (await createUser(db, { email: "t@exemple.fr", displayName: "T", password: "un mot de passe solide" })).id;
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  it("sans profil validé, rien n'est demandé ; ensuite, un matching par offre, une seule fois tant que rien ne change", async () => {
    const offerId = await analyzed("A");
    expect(await autoMatch(deps, userId, offerId)).toBe("no_profile");
    expect(await triageCounts(db, userId)).toMatchObject({ toDecide: 1, unscored: 0, hasProfile: false });
    await validateProfile();
    expect(await triageCounts(db, userId)).toMatchObject({ toDecide: 1, unscored: 1, hasProfile: true });
    expect(await autoMatch(deps, userId, offerId)).toBe("requested");
    expect(await autoMatch(deps, userId, offerId)).toBe("up_to_date");
    await computeAll();
    const [item] = await listToTriage(db, userId);
    expect(item!.match).toMatchObject({ status: "done", mode: "rules_only", stale: false });
    expect(typeof item!.match!.score).toBe("number");
    expect(await triageCounts(db, userId)).toMatchObject({ unscored: 0 });
  });

  it("garde les poids réglés quand une nouvelle analyse relance le matching", async () => {
    await validateProfile();
    const offerId = await analyzed("B");
    await autoMatch(deps, userId, offerId);
    await computeAll();
    const weights = { ...DEFAULT_WEIGHTS, mandatory: 70, preferred: 10, experience: 10, conditions: 10 };
    const [first] = await db.select({ id: matchAnalyses.id }).from(matchAnalyses).where(eq(matchAnalyses.offerId, offerId));
    expect(await updateWeights(db, userId, first!.id, weights)).not.toBeUndefined();
    // Nouvelle version d'analyse (relance manuelle) : le matching repart avec les mêmes poids.
    await db.update(offerAnalyses).set({ state: "superseded" }).where(eq(offerAnalyses.offerId, offerId));
    await db.update(jobOffers).set({ status: "queued" }).where(eq(jobOffers.id, offerId));
    await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId, userId });
    expect(await autoMatch(deps, userId, offerId)).toBe("requested");
    const [current] = await db
      .select({ weights: matchAnalyses.weights })
      .from(matchAnalyses)
      .where(and(eq(matchAnalyses.offerId, offerId), eq(matchAnalyses.state, "current")));
    expect(current!.weights).toEqual(weights);
  });

  it("classe les offres à traiter par score, puis les matchings en cours, puis les offres sans score ; les offres décidées en sortent", async () => {
    await validateProfile();
    const [low, high, pending, none, decided] = [await analyzed("bas"), await analyzed("haut"), await analyzed("en cours"), await analyzed("sans"), await analyzed("décidée")];
    for (const id of [low, high, pending, decided]) await autoMatch(deps, userId, id);
    const pendingMatch = enqueued.splice(2, 1);
    await computeAll();
    await db.update(matchAnalyses).set({ score: 41 }).where(eq(matchAnalyses.offerId, low));
    await db.update(matchAnalyses).set({ score: 83 }).where(eq(matchAnalyses.offerId, high));
    expect(await decideOffer(db, userId, decided, "discard")).toBe(true);
    // Une offre « à compléter » n'est pas à décider : elle attend son texte.
    await ingestOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, userId, { origin: "email_alert", board: "wttj", externalId: "x", url: "https://www.welcometothejungle.com/fr/companies/a/jobs/b", title: "Extrait", company: "A", location: "Lyon", publishedAt: null, text: "extrait", complete: false });

    const list = await listToTriage(db, userId);
    expect(list.map((i) => i.offerId)).toEqual([high, low, pending, none]);
    expect(list.map((i) => i.match?.status ?? null)).toEqual(["done", "done", "pending", null]);
    expect(await triageCounts(db, userId)).toMatchObject({ toDecide: 4, incomplete: 1, unscored: 1 });

    // Profil revalidé : les scores deviennent périmés et se recalculent à la demande, dans la limite donnée.
    await validateProfile("\nPermis B.");
    expect((await listToTriage(db, userId)).every((i) => !i.match || i.match.stale)).toBe(true);
    expect(await requestMissingMatches(deps, userId, 2)).toBe(2);
    expect(await requestMissingMatches(deps, userId)).toBe(2);
    expect(await requestMissingMatches(deps, userId)).toBe(0);
    expect(pendingMatch).toHaveLength(1);
  });
});
