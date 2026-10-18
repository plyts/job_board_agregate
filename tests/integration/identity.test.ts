import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { sessions } from "@/db/schema";
import { createUser, invalidateSession, login, MAX_FAILED_ATTEMPTS, validateSessionToken } from "@/modules/identity";
import { hashToken, SESSION_TTL_MS } from "@/modules/identity/sessions";
import { closeTestDb, getTestDb, resetDb } from "./db";

const PASSWORD = "un mot de passe solide";

describe("identité", async () => {
  const db = await getTestDb();
  beforeEach(() => resetDb(db));
  afterAll(() => closeTestDb());

  it("normalise l'e-mail et refuse un mot de passe trop court", async () => {
    const user = await createUser(db, { email: "  Camille@Exemple.FR ", displayName: "Camille", password: PASSWORD });
    expect(user.email).toBe("camille@exemple.fr");
    await expect(createUser(db, { email: "b@exemple.fr", displayName: "B", password: "court" })).rejects.toThrow();
  });

  it("ouvre une session valide, stockée sous forme d'empreinte", async () => {
    const { id } = await createUser(db, { email: "c@exemple.fr", displayName: "C", password: PASSWORD });
    const result = await login(db, "C@exemple.fr", PASSWORD);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stored = await db.select().from(sessions).where(eq(sessions.userId, id));
    expect(stored).toHaveLength(1);
    expect(stored[0]?.id).toBe(hashToken(result.token));
    expect(stored[0]?.id).not.toBe(result.token);
    const session = await validateSessionToken(db, result.token);
    expect(session?.user.email).toBe("c@exemple.fr");
  });

  it("donne la même réponse pour un e-mail inconnu et un mauvais mot de passe", async () => {
    await createUser(db, { email: "d@exemple.fr", displayName: "D", password: PASSWORD });
    expect(await login(db, "d@exemple.fr", "mauvais mot de passe")).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(await login(db, "inconnu@exemple.fr", PASSWORD)).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it(`verrouille après ${MAX_FAILED_ATTEMPTS} échecs, même avec le bon mot de passe`, async () => {
    await createUser(db, { email: "e@exemple.fr", displayName: "E", password: PASSWORD });
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) await login(db, "e@exemple.fr", "faux");
    expect(await login(db, "e@exemple.fr", PASSWORD)).toEqual({ ok: false, reason: "locked" });
    const later = new Date(Date.now() + 16 * 60 * 1000);
    expect((await login(db, "e@exemple.fr", PASSWORD, later)).ok).toBe(true);
  });

  it("refuse une session expirée ou invalidée et prolonge une session ancienne", async () => {
    await createUser(db, { email: "f@exemple.fr", displayName: "F", password: PASSWORD });
    const t0 = new Date("2026-01-01T00:00:00Z");
    const r = await login(db, "f@exemple.fr", PASSWORD, t0);
    if (!r.ok) throw new Error("connexion attendue");

    const day20 = new Date(t0.getTime() + 20 * 24 * 3600 * 1000);
    const renewed = await validateSessionToken(db, r.token, day20);
    expect(renewed?.renewed).toBe(true);
    expect(renewed?.expiresAt.getTime()).toBe(day20.getTime() + SESSION_TTL_MS);

    const afterExpiry = new Date(day20.getTime() + SESSION_TTL_MS + 1000);
    expect(await validateSessionToken(db, r.token, afterExpiry)).toBeNull();

    const r2 = await login(db, "f@exemple.fr", PASSWORD);
    if (!r2.ok) throw new Error("connexion attendue");
    await invalidateSession(db, r2.token);
    expect(await validateSessionToken(db, r2.token)).toBeNull();
    expect(await validateSessionToken(db, "jeton-inexistant")).toBeNull();
  });
});
