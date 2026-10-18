import { createHash, randomBytes } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { sessions, users } from "@/db/schema";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Une session utilisée alors qu'il lui reste moins de 15 jours est prolongée. */
const RENEW_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

export type SessionUser = { id: string; email: string; displayName: string };
export type ValidSession = { sessionId: string; expiresAt: Date; user: SessionUser; renewed: boolean };

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(db: Db, userId: string, now = new Date()): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function validateSessionToken(db: Db, token: string, now = new Date()): Promise<ValidSession | null> {
  if (!token || token.length > 128) return null;
  const id = hashToken(token);
  const rows = await db
    .select({
      sessionId: sessions.id,
      expiresAt: sessions.expiresAt,
      userId: users.id,
      email: users.email,
      displayName: users.displayName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() <= now.getTime()) {
    await db.delete(sessions).where(eq(sessions.id, id));
    return null;
  }
  let expiresAt = row.expiresAt;
  let renewed = false;
  if (expiresAt.getTime() - now.getTime() < RENEW_THRESHOLD_MS) {
    expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
    await db.update(sessions).set({ expiresAt }).where(eq(sessions.id, id));
    renewed = true;
  }
  return { sessionId: id, expiresAt, renewed, user: { id: row.userId, email: row.email, displayName: row.displayName } };
}

export async function invalidateSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function invalidateUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function deleteExpiredSessions(db: Db, now = new Date()): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, now));
}
