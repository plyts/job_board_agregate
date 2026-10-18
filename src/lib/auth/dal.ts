import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { getDb } from "@/db/client";
import { validateSessionToken, type SessionUser } from "@/modules/identity";
import { SESSION_COOKIE, sessionCookieOptions } from "./cookie";

/** Session vérifiée en base, mémorisée pour la durée d'un rendu. */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await validateSessionToken(getDb(), token);
  if (!session) return null;
  if (session.renewed) {
    // Le rendu d'un Server Component ne peut pas écrire de cookie : la prolongation est rattrapée à la prochaine action.
    try {
      store.set(SESSION_COOKIE, token, sessionCookieOptions(session.expiresAt));
    } catch {}
  }
  return session.user;
});

/** À appeler en tête de chaque page, Server Action et Route Handler protégés. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
