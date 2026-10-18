import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures";

test("le tableau de bord mesure l'entonnoir sur la journée ou 7 jours", async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole("heading", { name: "Ta journée de recherche" })).toBeVisible();
  const funnel = page.getByRole("region", { name: "Entonnoir de traitement" });
  await expect(funnel.getByRole("listitem")).toHaveCount(8);
  // Données préparées : au moins 2 offres importées et analysées par projet Playwright.
  const collected = Number(await funnel.getByRole("listitem").filter({ hasText: "Offres collectées" }).locator("span").last().textContent());
  expect(collected).toBeGreaterThanOrEqual(4);
  // Les envois de l'encart « Résultats réels » et de l'entonnoir viennent des mêmes événements.
  const sentFunnel = await funnel.getByRole("listitem").filter({ hasText: "Candidatures envoyées" }).locator("span").last().textContent();
  await expect(page.getByRole("region", { name: "Résultats réels" }).getByText("Candidatures envoyées (confirmées)").locator("..")).toContainText(sentFunnel!);

  await page.getByRole("link", { name: "7 jours" }).click();
  await expect(page.getByText(/Tableau de bord · .* · du \d{2}\/\d{2} au \d{2}\/\d{2}/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Santé du pipeline" })).toContainText("Coût IA sur 7 jours");
  await expect(page.getByRole("region", { name: "Par source" })).toContainText("Connecteurs officiels (V2)");
});
