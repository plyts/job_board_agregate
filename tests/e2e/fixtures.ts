import type { Page } from "@playwright/test";

export const E2E_PROJECTS = ["desktop", "mobile"] as const;

export function analyzedOfferTitle(project: string) {
  return `Senior Data Engineer (${project})`;
}

export const E2E_USER = { email: "e2e@jobpilot.test", displayName: "Compte e2e", password: "motdepasse-e2e-solide" };
/** Compte sans profil, pour le parcours de saisie du profil maître. */
export const E2E_PROFILE_USER = { email: "e2e-profil@jobpilot.test", displayName: "Compte profil", password: "motdepasse-e2e-solide" };

export async function signIn(page: Page, user: { email: string; password: string } = E2E_USER) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(user.email);
  await page.getByLabel("Mot de passe").fill(user.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("/");
}
