import { sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { analyzeOffer, decideOffer } from "@/modules/analysis";
import { localDate } from "@/modules/applications";
import { createUser } from "@/modules/identity";
import { getDashboard } from "@/modules/metrics";
import { importOffer } from "@/modules/offers";
import { FakeLlmClient } from "@/modules/platform/llm/fake";
import { LocalFsStorage } from "@/modules/platform/storage";
import { EXTRACTION, OFFER_TEXT } from "../helpers/fixtures";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const TZ = "Europe/Paris";

describe("tableau de bord", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const storage = new LocalFsStorage("/tmp/jobpilot-unused");
  const today = localDate(new Date(), TZ);
  /** Instant local (Paris) d'un jour relatif à aujourd'hui. */
  const at = (daysAgo: number, time = "12:00") => sql.raw(`((date '${today}' - ${daysAgo}) + time '${time}') at time zone '${TZ}'`);
  let userId = "";
  let other = "";

  async function offer(uid: string, text: string, analyze: boolean) {
    const r = await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, uid, { kind: "text", text });
    if (!r.ok) throw new Error(r.message);
    if (analyze) await analyzeOffer({ db, pool, llm: new FakeLlmClient().respondWith(EXTRACTION) }, { offerId: r.offerId, userId: uid });
    return r.offerId;
  }

  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "d@exemple.fr", displayName: "D", password: "un mot de passe solide" })).id;
    other = (await createUser(db, { email: "e@exemple.fr", displayName: "E", password: "un mot de passe solide" })).id;

    const a = await offer(userId, `${OFFER_TEXT}\nA`, true);
    const b = await offer(userId, `${OFFER_TEXT}\nB`, true);
    const c = await offer(userId, `${OFFER_TEXT}\nC`, true);
    await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, userId, { kind: "text", text: `${OFFER_TEXT}\nA` }); // doublon
    expect(await decideOffer(db, userId, a, "qualify")).toBe(true);
    expect(await decideOffer(db, userId, b, "discard")).toBe(true);
    // L'offre C a été importée, analysée et qualifiée il y a 3 jours.
    await db.execute(sql`update offer_imports set created_at = ${at(3)} where offer_id = ${c}`);
    await db.execute(sql`update offer_analyses set created_at = ${at(3)} where offer_id = ${c}`);
    await db.execute(sql`insert into offer_events (user_id, offer_id, type, occurred_at) values (${userId}, ${c}, 'qualified', ${at(3)})`);
    // Décision à 00:30 heure de Paris aujourd'hui (la veille en UTC) : comptée aujourd'hui.
    await db.execute(sql`insert into offer_events (user_id, offer_id, type, occurred_at) values (${userId}, ${c}, 'qualified', ${at(0, "00:30")})`);
    // Hors des 7 jours.
    await db.execute(sql`insert into offer_events (user_id, offer_id, type, occurred_at) values (${userId}, ${b}, 'qualified', ${at(9)})`);

    // Candidature envoyée aujourd'hui, entretien il y a 2 jours (saisie tardive), relance en retard.
    const [app] = (
      await db.execute<{ id: string }>(
        sql`insert into applications (user_id, offer_id, status, sent_at, next_action, next_action_at) values (${userId}, ${a}, 'hr_interview', ${today}::date, 'Relancer', ${today}::date - 1) returning id`,
      )
    ).rows;
    await db.execute(sql`insert into application_events (user_id, application_id, type, to_status, occurred_at) values
      (${userId}, ${app!.id}, 'created', 'ready', ${at(1)}),
      (${userId}, ${app!.id}, 'sent', 'sent', ${at(0)}),
      (${userId}, ${app!.id}, 'status_changed', 'hr_interview', ${at(2)})`);
    const [closed] = (await db.execute<{ id: string }>(sql`insert into applications (user_id, offer_id, status) values (${userId}, ${b}, 'rejected') returning id`)).rows;
    await db.execute(sql`insert into application_events (user_id, application_id, type, to_status, occurred_at) values (${userId}, ${closed!.id}, 'status_changed', 'rejected', ${at(8)})`);
    await db.execute(sql`insert into llm_calls (user_id, purpose, provider, model, prompt_version, schema_version, input_hash, status, cost_usd, latency_ms, created_at) values
      (${userId}, 'offer.extract', 'local', 'm', 'v', 1, 'h', 'ok', 0.02, 1000, ${at(0)}),
      (${userId}, 'offer.extract', 'local', 'm', 'v', 1, 'h', 'ok', 0.03, 3000, ${at(5)})`);

    // Bruit d'un autre compte : jamais compté.
    const o = await offer(other, `${OFFER_TEXT}\nAutre`, true);
    await decideOffer(db, other, o, "qualify");
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  /** Recalcul indépendant, en SQL brut, sur les mêmes bornes. */
  async function recount(from: number) {
    const range = (col: string) => `(${col} at time zone '${TZ}')::date between date '${today}' - ${from} and date '${today}'`;
    const n = async (q: string) => Number((await db.execute<{ n: string }>(sql.raw(q.replaceAll("$U", `'${userId}'`)))).rows[0]!.n);
    return {
      collected: await n(`select count(*) n from offer_imports where user_id = $U and ${range("created_at")}`),
      fresh: await n(`select count(*) n from offer_imports where user_id = $U and outcome = 'created' and ${range("created_at")}`),
      analyzed: await n(`select count(distinct offer_id) n from offer_analyses where user_id = $U and ${range("created_at")}`),
      qualified: await n(`select count(distinct offer_id) n from offer_events where user_id = $U and type = 'qualified' and ${range("occurred_at")}`),
      cvFinalized: await n(`select count(distinct offer_id) n from cv_versions where user_id = $U and status = 'finalized' and ${range("finalized_at")}`),
      prepared: await n(`select count(distinct application_id) n from application_events where user_id = $U and to_status = 'ready' and ${range("occurred_at")}`),
      sent: await n(`select count(*) n from application_events where user_id = $U and type = 'sent' and ${range("occurred_at")}`),
      interviews: await n(`select count(distinct application_id) n from application_events where user_id = $U and to_status in ('hr_interview', 'tech_interview') and ${range("occurred_at")}`),
    };
  }

  it("calcule chaque étape de l'entonnoir à partir d'événements datés, comme un recalcul SQL indépendant", async () => {
    const day = await getDashboard(db, userId, { period: "day", today, timeZone: TZ, dailyGoal: 20 });
    expect(day.funnel).toEqual(await recount(0));
    expect(day.funnel).toEqual({ collected: 3, fresh: 2, analyzed: 2, qualified: 2, cvFinalized: 0, prepared: 0, sent: 1, interviews: 0 });
    expect(day.goal).toEqual({ processed: 3, target: 20 });
    expect(day.results).toEqual({ sent: 1, interviews: 0, refusals: 0, overdue: 1 });
    expect(day.rates).toEqual({ duplicates: 33, qualification: 100, qualifiedToSent: 50 });

    const week = await getDashboard(db, userId, { period: "week", today, timeZone: TZ, dailyGoal: 20 });
    expect(week.funnel).toEqual(await recount(6));
    expect(week.funnel).toEqual({ collected: 4, fresh: 3, analyzed: 3, qualified: 2, cvFinalized: 0, prepared: 1, sent: 1, interviews: 1 });
    expect(week.goal).toEqual({ processed: 3, target: 140 });
    expect(week.results.refusals).toBe(0); // refus il y a 8 jours : hors période
    // Les analyses ci-dessus passent aussi par le journal (faux client) : on recalcule plutôt que de supposer.
    const [llm] = (
      await db.execute<{ avg: string; n: string; cost: string }>(
        sql.raw(`select avg(latency_ms) avg, count(*) filter (where purpose = 'offer.extract' and status = 'ok') n, (select sum(cost_usd) from llm_calls where user_id = '${userId}' and (created_at at time zone '${TZ}')::date between date '${today}' - 6 and date '${today}') cost
          from llm_calls where user_id = '${userId}' and purpose = 'offer.extract' and status = 'ok' and (created_at at time zone '${TZ}')::date between date '${today}' - 6 and date '${today}'`),
      )
    ).rows;
    expect(week.health).toEqual({
      queued: 0,
      failed: 0,
      avgAnalysisMs: Math.round(Number(llm!.avg)),
      analysesMeasured: Number(llm!.n),
      periodCostUsd: Number(llm!.cost),
      costTodayUsd: expect.any(Number),
      budgetUsd: expect.any(Number),
    });
    // 3 analyses réelles (faux client) + 2 lignes datées insérées ; l'appel d'il y a 5 jours compte sur 7 jours.
    expect(Number(llm!.n)).toBe(5);
    expect(week.sources.find((s) => s.source === "text")).toEqual({ source: "text", collected: 4, duplicates: 1, qualified: 2 });
    expect(week.todo.overdue.map((t) => t.nextAction)).toEqual(["Relancer"]);
  });

  it("n'affiche rien d'un autre compte", async () => {
    const empty = (await createUser(db, { email: "f@exemple.fr", displayName: "F", password: "un mot de passe solide" })).id;
    const d = await getDashboard(db, empty, { period: "week", today, timeZone: TZ, dailyGoal: 20 });
    expect(Object.values(d.funnel).every((v) => v === 0)).toBe(true);
    expect(d.todo.overdue).toEqual([]);
    expect(d.rates).toEqual({ duplicates: null, qualification: null, qualifiedToSent: null });
  });
});
