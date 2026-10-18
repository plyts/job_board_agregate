import { eq, inArray, isNotNull, and } from "drizzle-orm";
import { strToU8, zipSync } from "fflate";
import type { Db } from "@/db/client";
import {
  applicationContacts,
  applicationDocuments,
  applicationEvents,
  applications,
  companies,
  cvSuggestions,
  cvVersions,
  jobOffers,
  jobRequirements,
  llmCalls,
  loginAttempts,
  matchAnalyses,
  matchItems,
  offerAnalyses,
  offerEvents,
  offerImports,
  profileVersions,
  requirementCorrections,
  users,
} from "@/db/schema";
import { verifyPassword } from "@/modules/identity/password";
import type { ObjectStorage } from "@/modules/platform/storage";

export type AccountDeps = { db: Db; storage: ObjectStorage };

/** Fichiers stockés rattachés au compte : CV importés, offres en fichier, documents envoyés. */
async function storedFiles(db: Db, userId: string): Promise<{ key: string; name: string }[]> {
  const [profiles, offers, docs] = await Promise.all([
    db.select({ key: profileVersions.sourceFileKey, version: profileVersions.version }).from(profileVersions).where(and(eq(profileVersions.userId, userId), isNotNull(profileVersions.sourceFileKey))),
    db.select({ key: jobOffers.sourceFileKey, id: jobOffers.id }).from(jobOffers).where(and(eq(jobOffers.userId, userId), isNotNull(jobOffers.sourceFileKey))),
    db.select({ key: applicationDocuments.storageKey, name: applicationDocuments.fileName, id: applicationDocuments.id }).from(applicationDocuments).where(eq(applicationDocuments.userId, userId)),
  ]);
  const ext = (k: string) => k.match(/\.[a-z0-9]{1,8}$/)?.[0] ?? "";
  return [
    ...profiles.map((p) => ({ key: p.key!, name: `profil/cv-importe-v${p.version}${ext(p.key!)}` })),
    ...offers.map((o) => ({ key: o.key!, name: `offres/${o.id}${ext(o.key!)}` })),
    ...docs.map((d) => ({ key: d.key, name: `candidatures/${d.id}-${d.name.replace(/[/\\]/g, "_")}` })),
  ];
}

/**
 * Export complet du compte (RGPD, portabilité) : toutes les données en JSON et les fichiers stockés, dans une archive ZIP.
 * Ni mot de passe haché ni jetons de session.
 */
export async function exportAccount(deps: AccountDeps, userId: string, now = new Date()): Promise<Uint8Array> {
  const { db } = deps;
  const by = <T extends { userId: unknown }>(table: T) => eq((table as unknown as { userId: typeof users.id }).userId, userId);
  const [user] = await db.select({ id: users.id, email: users.email, displayName: users.displayName, createdAt: users.createdAt }).from(users).where(eq(users.id, userId));
  const matches = await db.select().from(matchAnalyses).where(by(matchAnalyses));
  const data = {
    format: "jobpilot-export-v1",
    exportedAt: now.toISOString(),
    user,
    companies: await db.select().from(companies).where(by(companies)),
    offers: await db.select().from(jobOffers).where(by(jobOffers)),
    offerImports: await db.select().from(offerImports).where(by(offerImports)),
    offerEvents: await db.select().from(offerEvents).where(by(offerEvents)),
    offerAnalyses: await db.select().from(offerAnalyses).where(by(offerAnalyses)),
    requirements: await db.select().from(jobRequirements).where(by(jobRequirements)),
    requirementCorrections: await db.select().from(requirementCorrections).where(by(requirementCorrections)),
    profileVersions: await db.select().from(profileVersions).where(by(profileVersions)),
    matches,
    matchItems: matches.length ? await db.select().from(matchItems).where(inArray(matchItems.matchId, matches.map((m) => m.id))) : [],
    cvVersions: await db.select().from(cvVersions).where(by(cvVersions)),
    cvSuggestions: await db.select().from(cvSuggestions).where(by(cvSuggestions)),
    applications: await db.select().from(applications).where(by(applications)),
    applicationDocuments: await db.select().from(applicationDocuments).where(by(applicationDocuments)),
    applicationEvents: await db.select().from(applicationEvents).where(by(applicationEvents)),
    applicationContacts: await db.select().from(applicationContacts).where(by(applicationContacts)),
    // Journal des appels IA : métadonnées seulement (aucun contenu n'y est jamais stocké).
    llmCalls: await db.select().from(llmCalls).where(by(llmCalls)),
  };
  const files: Record<string, Uint8Array> = {
    "LISEZ-MOI.txt": strToU8(
      "Export JobPilot : donnees.json contient toutes tes données (offres, analyses, profil maître et ses versions, CV personnalisés, matchings, candidatures, événements, contacts, journal des appels IA sans contenu). Le dossier fichiers/ contient les fichiers stockés (CV importés, offres en fichier, documents réellement envoyés).\n",
    ),
    "donnees.json": strToU8(JSON.stringify(data, null, 2)),
  };
  const missing: string[] = [];
  for (const f of await storedFiles(db, userId)) {
    try {
      files[`fichiers/${f.name}`] = new Uint8Array(await deps.storage.get(f.key));
    } catch {
      missing.push(f.name);
    }
  }
  if (missing.length) files["fichiers-manquants.txt"] = strToU8(`${missing.join("\n")}\n`);
  return zipSync(files, { level: 6, mtime: now });
}

export type DeleteAccountResult = { ok: true; filesDeleted: number } | { ok: false; error: string };

/**
 * Suppression définitive du compte : toutes les lignes (les triggers d'immuabilité laissent passer
 * la suppression du compte), puis les fichiers stockés. Confirmée par l'e-mail et le mot de passe.
 */
export async function deleteAccount(deps: AccountDeps, userId: string, confirmation: { email: string; password: string }): Promise<DeleteAccountResult> {
  const { db } = deps;
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) return { ok: false, error: "Compte introuvable." };
  if (confirmation.email.trim().toLowerCase() !== user.email || !(await verifyPassword(confirmation.password, user.passwordHash))) {
    return { ok: false, error: "E-mail ou mot de passe incorrect : rien n'a été supprimé." };
  }
  const files = await storedFiles(db, userId);
  await db.delete(users).where(eq(users.id, userId));
  await db.delete(loginAttempts).where(eq(loginAttempts.email, user.email));
  let filesDeleted = 0;
  for (const f of files) {
    try {
      await deps.storage.delete(f.key);
      filesDeleted++;
    } catch {
      // Fichier déjà absent : rien à faire.
    }
  }
  return { ok: true, filesDeleted };
}
