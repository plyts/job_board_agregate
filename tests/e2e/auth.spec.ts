import { expect, test } from "@playwright/test";
import { E2E_USER, signIn } from "./fixtures";

test("une page protégée redirige vers la connexion", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();
});

test("une API protégée répond 401 sans session", async ({ request }) => {
  const res = await request.get("/api/offers");
  expect(res.status()).toBe(401);
});

test("un mauvais mot de passe affiche une erreur générique", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(E2E_USER.email);
  await page.getByLabel("Mot de passe").fill("pas le bon mot de passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("#login-error")).toHaveText("E-mail ou mot de passe incorrect.");
});

test("connexion puis déconnexion", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Ta journée de recherche" })).toBeVisible();
  await expect(page.getByText(E2E_USER.displayName)).toBeVisible();
  await page.getByRole("button", { name: "Déconnexion" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
});
