import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db/client";
import { aiConsents } from "@/db/schema";

/** Un modèle local traite les données sur ta machine : pas de transfert, pas de consentement requis. */
export const NO_CONSENT_NEEDED = new Set(["local"]);

export async function consentedProviders(db: Db, userId: string): Promise<Set<string>> {
  const rows = await db
    .select({ provider: aiConsents.provider })
    .from(aiConsents)
    .where(and(eq(aiConsents.userId, userId), isNull(aiConsents.revokedAt)));
  return new Set(rows.map((r) => r.provider));
}

export async function listConsents(db: Db, userId: string) {
  return db.select().from(aiConsents).where(eq(aiConsents.userId, userId));
}

/** Consentement explicite, horodaté ; un consentement déjà actif n'est pas dupliqué (index unique partiel). */
export async function grantConsent(db: Db, userId: string, provider: string): Promise<void> {
  await db.insert(aiConsents).values({ userId, provider }).onConflictDoNothing();
}

/** Retrait du consentement : effet immédiat sur les prochains envois ; l'historique reste daté. */
export async function revokeConsent(db: Db, userId: string, provider: string): Promise<void> {
  await db
    .update(aiConsents)
    .set({ revokedAt: new Date() })
    .where(and(eq(aiConsents.userId, userId), eq(aiConsents.provider, provider), isNull(aiConsents.revokedAt)));
}
