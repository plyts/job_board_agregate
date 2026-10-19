import { eq } from "drizzle-orm";
import { ImapFlow } from "imapflow";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { jobOffers, jobSources, offerSightings } from "@/db/schema";
import { createUser } from "@/modules/identity";
import { completeOfferText } from "@/modules/offers";
import { LocalFsStorage } from "@/modules/platform/storage";
import { connectEmailAlerts, syncEmailAlerts, type SourcesDeps } from "@/modules/sources";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "../integration/db";

/** Serveur IMAP de test : docker run -p 3143:3143 -e GREENMAIL_OPTS="-Dgreenmail.setup.test.all -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=alertes:mot-de-passe-app@localhost" greenmail/standalone:2.1.5 */
const IMAP = { host: process.env.IMAP_TEST_HOST ?? "127.0.0.1", port: Number(process.env.IMAP_TEST_PORT ?? 3143), user: "alertes", password: "mot-de-passe-app" };

function mail(from: string, subject: string, body: { html?: string; text?: string }): string {
  const boundary = "jobpilot-limite";
  const parts = [
    body.text ? `--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body.text}\r\n` : "",
    body.html ? `--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${body.html}\r\n` : "",
  ].join("");
  return [
    `From: ${from}`,
    "To: alertes@localhost",
    `Subject: ${subject}`,
    `Date: ${new Date("2026-10-18T07:00:00Z").toUTCString()}`,
    `Message-ID: <${Math.random().toString(36).slice(2)}@test>`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `${parts}--${boundary}--`,
    "",
  ].join("\r\n");
}

const WTTJ = mail("Welcome to the Jungle <alerts@welcometothejungle.com>", "3 nouvelles offres pour « Data »", {
  html: `<table>
    <tr><td><a href="https://www.welcometothejungle.com/fr/companies/nordwave/jobs/data-engineer_lyon?utm_source=alert">Data Engineer</a><br>Nordwave<br>Lyon</td></tr>
    <tr><td><a href="https://click.welcometothejungle.com/ls/click?upn=lumio">Analytics Engineer</a><br>Lumio<br>Paris</td></tr>
    <tr><td><a href="https://click.welcometothejungle.com/unsubscribe">Se désabonner</a></td></tr></table>`,
});
const LINKEDIN = mail("LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>", "Data Engineer : 1 nouvel emploi", {
  html: `<div><a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc&refId=x"><img alt="logo"></a>
    <a href="https://www.linkedin.com/comm/jobs/view/4012345678/?trackingId=abc">Senior Data Engineer</a><p>Sencia</p><p>Lyon, Auvergne-Rhône-Alpes, France</p></div>`,
});
const INDEED = mail("Indeed <alert@indeed.com>", "Nouveaux emplois : data engineer", {
  text: "Data Engineer Python\nLumio - Villeurbanne (69)\nhttps://fr.indeed.com/rc/clk/dl?jk=0123456789abcdef&from=ja\n",
});
const NEWSLETTER = mail("Newsletter <news@exemple.fr>", "Promotions", { html: "<p>Rien à voir</p>" });

describe("alertes e-mail lues en IMAP (GreenMail)", { timeout: 30_000 }, async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const resolved: string[] = [];
  const deps: SourcesDeps = {
    db,
    pool,
    storage: new LocalFsStorage("/tmp/jobpilot-imap-unused"),
    enqueueAnalysis: async () => {},
    imap: { allowPrivateHost: true, allowPlaintext: true },
    resolve: async (u) => {
      resolved.push(u);
      return "https://www.welcometothejungle.com/fr/companies/lumio/jobs/analytics-engineer_paris";
    },
  };
  let userId = "";

  async function mailbox<T>(fn: (c: ImapFlow) => Promise<T>): Promise<T> {
    const c = new ImapFlow({ host: IMAP.host, port: IMAP.port, secure: false, auth: { user: IMAP.user, pass: IMAP.password }, logger: false });
    await c.connect();
    try {
      return await fn(c);
    } finally {
      await c.logout();
    }
  }

  beforeEach(async () => {
    await resetDb(db);
    resolved.length = 0;
    userId = (await createUser(db, { email: "m@exemple.fr", displayName: "M", password: "un mot de passe solide" })).id;
    // Boîte vidée entre deux tests.
    await mailbox(async (c) => {
      const lock = await c.getMailboxLock("INBOX");
      try {
        if (c.mailbox && c.mailbox.exists) await c.messageDelete("1:*");
      } finally {
        lock.release();
      }
    });
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  const connect = () =>
    connectEmailAlerts(deps, userId, { host: IMAP.host, port: IMAP.port, secure: false, user: IMAP.user, password: IMAP.password, folder: "INBOX", autoFetch: false });

  it("refuse un mauvais mot de passe, puis lit les alertes sans modifier la boîte et ne relit pas les messages traités", async () => {
    expect(await connectEmailAlerts(deps, userId, { host: IMAP.host, port: IMAP.port, secure: false, user: IMAP.user, password: "faux", folder: "INBOX", autoFetch: false })).toMatchObject({
      ok: false,
      error: expect.stringContaining("refuse"),
    });
    await mailbox(async (c) => {
      for (const m of [WTTJ, LINKEDIN, INDEED, NEWSLETTER]) await c.append("INBOX", m);
    });
    const connected = await connect();
    expect(connected).toMatchObject({ ok: true });
    const sourceId = connected.ok ? connected.sourceId : "";

    const run = await syncEmailAlerts(deps, userId, sourceId);
    expect(run).toMatchObject({ status: "ok", fetched: 4, created: 4 });
    expect(run!.errors).toEqual(["Non reconnu : exemple.fr (1 e-mail)"]);
    expect(resolved).toEqual(["https://click.welcometothejungle.com/ls/click?upn=lumio"]);

    const offers = await db.select().from(jobOffers).where(eq(jobOffers.userId, userId));
    expect(offers.map((o) => o.title).sort()).toEqual(["Analytics Engineer", "Data Engineer", "Data Engineer Python", "Senior Data Engineer"]);
    expect(offers.every((o) => o.status === "incomplete" && o.source === "email_alert")).toBe(true);
    const sightings = await db.select().from(offerSightings).where(eq(offerSightings.userId, userId));
    expect(sightings.map((s) => `${s.board}:${s.externalId}`).sort()).toEqual([
      "indeed:0123456789abcdef",
      "linkedin:4012345678",
      "wttj:lumio/analytics-engineer_paris",
      "wttj:nordwave/data-engineer_lyon",
    ]);
    const linkedin = offers.find((o) => o.title === "Senior Data Engineer")!;
    expect(linkedin.originalUrl).toBe("https://www.linkedin.com/jobs/view/4012345678");
    expect(linkedin.rawText).toContain("Sencia");

    // Lecture seule : aucun message marqué lu ou supprimé.
    const flags = await mailbox(async (c) => {
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      try {
        const out: string[][] = [];
        for await (const m of c.fetch("1:*", { flags: true })) out.push([...(m.flags ?? [])]);
        return out;
      } finally {
        lock.release();
      }
    });
    // (« \Recent » est posé par le serveur à la réception, pas par JobPilot.)
    expect(flags).toHaveLength(4);
    expect(flags.flat().filter((f) => f === "\\Seen" || f === "\\Deleted")).toEqual([]);

    // Deuxième passage : rien de nouveau. Un nouveau message seulement est lu ensuite.
    expect(await syncEmailAlerts(deps, userId, sourceId)).toMatchObject({ fetched: 0, created: 0 });
    await mailbox((c) => c.append("INBOX", mail("HelloWork <alerte@hellowork.com>", "Offres", { text: "Data Analyst\nLumio - Lyon\nhttps://www.hellowork.com/fr-fr/emplois/58123456.html\n" })));
    expect(await syncEmailAlerts(deps, userId, sourceId)).toMatchObject({ fetched: 1, created: 1 });
    const [source] = await db.select().from(jobSources).where(eq(jobSources.id, sourceId));
    const lastUid = await mailbox(async (c) => {
      const lock = await c.getMailboxLock("INBOX", { readOnly: true });
      try {
        return c.mailbox ? c.mailbox.uidNext - 1 : 0;
      } finally {
        lock.release();
      }
    });
    expect(source!.cursor).toMatchObject({ lastUid });
    expect(source!.secret).not.toContain("mot-de-passe-app");

    // L'offre LinkedIn se complète en collant le texte : elle part en analyse.
    expect(await completeOfferText(deps, userId, linkedin.id, "Senior Data Engineer chez Sencia, à Lyon. Pipelines Python et SQL, Airflow, BigQuery ; équipe data de huit personnes.")).toEqual({ ok: true });
  });
});
