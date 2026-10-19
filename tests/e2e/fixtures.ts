import type { Page } from "@playwright/test";
import type { ProfileContent } from "../../src/modules/profile/content";

export const E2E_PROJECTS = ["desktop", "mobile"] as const;

export function analyzedOfferTitle(project: string) {
  return `Senior Data Engineer (${project})`;
}

/** Offre dont le CV est déjà finalisé, pour le parcours de candidature. */
export function applicationOfferTitle(project: string) {
  return `Lead Data Engineer (${project})`;
}

export const E2E_USER = { email: "e2e@jobpilot.test", displayName: "Compte e2e", password: "motdepasse-e2e-solide" };
/** Compte sans profil, pour le parcours de saisie du profil maître. */
export const E2E_PROFILE_USER = { email: "e2e-profil@jobpilot.test", displayName: "Compte profil", password: "motdepasse-e2e-solide" };

/** Compte du scénario « colonnes du Kanban » (un par projet) : son réglage ne touche pas le tableau des autres scénarios. */
export function boardUser(project: string) {
  return { email: `e2e-colonnes-${project}@jobpilot.test`, displayName: "Compte colonnes", password: "motdepasse-e2e-solide" };
}

/** Compte du scénario « sources » (un par projet) : ses offres importées ne se mêlent pas à celles des autres scénarios. */
export function sourcesUser(project: string) {
  return { email: `e2e-sources-${project}@jobpilot.test`, displayName: "Compte sources", password: "motdepasse-e2e-solide" };
}

/** Compte du scénario « À traiter » (un par projet) : offres classées par score, décisions sans effet sur les autres scénarios. */
export function triageUser(project: string) {
  return { email: `e2e-tri-${project}@jobpilot.test`, displayName: "Compte tri", password: "motdepasse-e2e-solide" };
}

export function triageOfferTitle(project: string, which: "haut" | "bas" | "sans") {
  return { haut: "Data Engineer très proche", bas: "Data Engineer éloigné", sans: "Data Engineer sans score" }[which] + ` (${project})`;
}

/** Comptes supprimés par le scénario « Mon compte » (un par projet Playwright). */
export function deletableUser(project: string) {
  return { email: `e2e-suppression-${project}@jobpilot.test`, displayName: "Compte jetable", password: "motdepasse-e2e-solide" };
}

export async function signIn(page: Page, user: { email: string; password: string } = E2E_USER) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("/");
}

/** Jugement simulé du matching, identique pour le profil maître et pour les recontrôles de CV. */
export const E2E_JUDGEMENT = (content: ProfileContent) => ({
  items: [
    { requirementRef: "R2", category: "confirmed", evidenceIds: [content.experiences[0]!.id], rationale: "30 pipelines Python/SQL chez Lumio.", action: "Rien à faire." },
    { requirementRef: "R3", category: "not_demonstrated", evidenceIds: [], rationale: "dbt absent du profil.", action: "Ne pas l'ajouter sans expérience réelle." },
    { requirementRef: "R4", category: "confirmed", evidenceIds: content.projects.slice(0, 1).map((p) => p.id), rationale: "Projet Databricks.", action: "Préciser le contexte." },
  ],
});
