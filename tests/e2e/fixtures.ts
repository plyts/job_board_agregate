import type { Page } from "@playwright/test";

export const E2E_USER = { email: "e2e@jobpilot.test", displayName: "Compte e2e", password: "motdepasse-e2e-solide" };

export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Mot de passe").fill(E2E_USER.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await page.waitForURL("/");
}
