import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures";

test("l'écran des fournisseurs IA montre l'état, la politique de données et n'expose aucune clé", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Fournisseurs IA" }).click();
  await expect(page.getByRole("heading", { name: "Fournisseurs IA" })).toBeVisible();

  const groq = page.getByRole("row", { name: /Groq/ });
  await expect(groq.getByText("Actif", { exact: true })).toBeVisible();
  await expect(groq.getByText("modele-e2e")).toBeVisible();
  await expect(groq.getByText("Refusées")).toBeVisible();

  const gemini = page.getByRole("row", { name: /Google Gemini/ });
  await expect(gemini.getByText("Inactif")).toBeVisible();
  await expect(gemini.getByText("manque GEMINI_MODEL, GEMINI_API_KEY")).toBeVisible();
  await expect(gemini.getByText(/contenus utilisés pour améliorer les produits Google/)).toBeVisible();

  await expect(page.locator("body")).not.toContainText("cle-factice-e2e");
});
