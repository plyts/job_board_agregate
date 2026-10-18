import { and, count, eq, gt, lt } from "drizzle-orm";
import type { Db } from "@/db/client";
import { loginAttempts } from "@/db/schema";
import { getDummyHash, verifyPassword } from "./password";
import { createSession } from "./sessions";
import { findUserByEmail, normalizeEmail } from "./users";

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

export type LoginResult =
  | { ok: true; token: string; expiresAt: Date; userId: string }
  | { ok: false; reason: "invalid_credentials" | "locked" };

export async function recentFailures(db: Db, email: string, now = new Date()): Promise<number> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MS);
  const [row] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, email), eq(loginAttempts.succeeded, false), gt(loginAttempts.createdAt, since)));
  return row?.n ?? 0;
}

/**
 * Vérifie les identifiants. Le message d'erreur ne distingue jamais un e-mail inconnu
 * d'un mauvais mot de passe, et le temps de réponse est comparable dans les deux cas.
 */
export async function login(db: Db, rawEmail: string, password: string, now = new Date()): Promise<LoginResult> {
  const email = normalizeEmail(rawEmail);
  if ((await recentFailures(db, email, now)) >= MAX_FAILED_ATTEMPTS) {
    return { ok: false, reason: "locked" };
  }
  const user = await findUserByEmail(db, email);
  const valid = user ? await verifyPassword(password, user.passwordHash) : (await verifyPassword(password, await getDummyHash()), false);
  await db.insert(loginAttempts).values({ email, succeeded: valid, createdAt: now });
  if (!user || !valid) return { ok: false, reason: "invalid_credentials" };
  const { token, expiresAt } = await createSession(db, user.id, now);
  return { ok: true, token, expiresAt, userId: user.id };
}

/** Minimisation : les tentatives de connexion ne servent qu'au verrouillage (15 min) ; effacées après 30 jours. */
export async function purgeLoginAttempts(db: Db, days = 30, now = new Date()): Promise<number> {
  const rows = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.createdAt, new Date(now.getTime() - days * 24 * 60 * 60 * 1000)))
    .returning({ id: loginAttempts.id });
  return rows.length;
}
