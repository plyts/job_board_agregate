import { existsSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createPool } from "@/db/client";
import { applicationDocuments, users } from "@/db/schema";
import { deleteAccount, exportAccount } from "@/modules/account";
import { addContact, confirmSend, createApplication } from "@/modules/applications";
import { createUser } from "@/modules/identity";
import { importOffer } from "@/modules/offers";
import { LocalFsStorage } from "@/modules/platform/storage";
import { OFFER_TEXT } from "../helpers/fixtures";
import { minimalPdf } from "../helpers/pdf";
import { closeTestDb, getTestDb, resetDb, TEST_DATABASE_URL } from "./db";

const PASSWORD = "un mot de passe solide";

describe("compte : export et suppression", async () => {
  const db = await getTestDb();
  const pool = createPool(TEST_DATABASE_URL);
  const root = await mkdtemp(path.join(tmpdir(), "jobpilot-account-"));
  const storage = new LocalFsStorage(root);
  let userId = "";
  let otherId = "";
  const pdf = minimalPdf(["CV envoyé"]);

  async function seed(uid: string, text: string) {
    const offer = await importOffer({ db, pool, storage, enqueueAnalysis: async () => {} }, uid, { kind: "text", text });
    if (!offer.ok) throw new Error(offer.message);
    const app = await createApplication(db, pool, uid, offer.offerId);
    if (!app.ok) throw new Error(app.message);
    await addContact(db, uid, app.applicationId, { name: "Alex", role: null, email: "alex@exemple.fr", phone: null, url: null, note: null });
    const sent = await confirmSend({ db, pool, storage }, uid, app.applicationId, { sentAt: "2026-10-17", channel: "email", file: { kind: "upload", fileName: "cv.pdf", bytes: pdf } }, new Date("2026-10-18T10:00:00Z"));
    if (!sent.ok) throw new Error(sent.error);
  }

  beforeEach(async () => {
    await resetDb(db);
    userId = (await createUser(db, { email: "moi@exemple.fr", displayName: "Moi", password: PASSWORD })).id;
    otherId = (await createUser(db, { email: "autre@exemple.fr", displayName: "Autre", password: PASSWORD })).id;
    await seed(userId, OFFER_TEXT);
    await seed(otherId, `${OFFER_TEXT}\nAutre compte.`);
  });
  afterAll(async () => {
    await pool.end();
    await closeTestDb();
  });

  it("exporte toutes les données et les fichiers du compte, sans secret ni donnée d'un autre compte", async () => {
    const zip = unzipSync(await exportAccount({ db, storage }, userId));
    const data = JSON.parse(strFromU8(zip["donnees.json"]!));
    expect(data.user).toMatchObject({ email: "moi@exemple.fr" });
    expect(data.offers).toHaveLength(1);
    expect(data.applications).toHaveLength(1);
    expect(data.applicationContacts).toHaveLength(1);
    expect(data.applicationEvents.map((e: { type: string }) => e.type)).toEqual(expect.arrayContaining(["created", "sent"]));
    const raw = strFromU8(zip["donnees.json"]!);
    expect(raw).not.toContain("password");
    expect(raw).not.toContain("autre@exemple.fr");
    const files = Object.keys(zip).filter((k) => k.startsWith("fichiers/"));
    expect(files).toHaveLength(1);
    expect(Buffer.from(zip[files[0]!]!).equals(pdf)).toBe(true);
  });

  it("ne supprime rien sans le bon mot de passe, puis supprime tout le compte et ses fichiers", async () => {
    const [doc] = await db.select().from(applicationDocuments).where(eq(applicationDocuments.userId, userId));
    const file = path.join(root, doc!.storageKey);
    expect(existsSync(file)).toBe(true);

    expect(await deleteAccount({ db, storage }, userId, { email: "moi@exemple.fr", password: "mauvais mot de passe" })).toMatchObject({ ok: false });
    expect(await deleteAccount({ db, storage }, userId, { email: "autre@exemple.fr", password: PASSWORD })).toMatchObject({ ok: false });
    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1);

    expect(await deleteAccount({ db, storage }, userId, { email: " Moi@Exemple.fr ", password: PASSWORD })).toEqual({ ok: true, filesDeleted: 1 });
    expect(existsSync(file)).toBe(false);
    // Plus aucune ligne rattachée au compte, dans aucune table.
    const tables = await db.execute<{ table_name: string }>(sql`select table_name from information_schema.columns where table_schema = 'public' and column_name = 'user_id'`);
    for (const { table_name } of tables.rows) {
      const n = await db.execute<{ n: string }>(sql.raw(`select count(*) n from "${table_name}" where user_id = '${userId}'`));
      expect([table_name, Number(n.rows[0]!.n)]).toEqual([table_name, 0]);
    }
    // L'autre compte est intact.
    const others = await db.select().from(applicationDocuments).where(eq(applicationDocuments.userId, otherId));
    expect(others).toHaveLength(1);
    expect(existsSync(path.join(root, others[0]!.storageKey))).toBe(true);
  });
});
