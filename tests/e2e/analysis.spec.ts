import { expect, test } from "@playwright/test";
import { analyzedOfferTitle, signIn } from "./fixtures";

test.beforeEach(async ({ page }, testInfo) => {
  const title = analyzedOfferTitle(testInfo.project.name);
  await signIn(page);
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: `${title} · Nordwave` })).toBeVisible();
});

test("l'analyse montre chaque exigence avec sa provenance et son extrait source", async ({ page }) => {
  await expect(page.getByText("éléments extraits")).toBeVisible();
  const mandatory = page.getByRole("region", { name: "Exigences obligatoires" });
  await mandatory.getByRole("button", { name: /Python et SQL/ }).click();
  await expect(page.locator("mark")).toHaveText("maîtrise de Python et SQL");

  // Citation inventée par le modèle : déclassée en « Incertain », avec la raison.
  await mandatory.getByRole("button", { name: /Kubernetes/ }).click();
  await expect(mandatory.getByText("Citation introuvable dans l'annonce : à vérifier.")).toBeVisible();
  await expect(page.locator("mark")).toHaveCount(0);

  await expect(page.getByText(/Non mentionné dans l'annonce \(jamais estimé\) : salaire, habilitation\./)).toBeVisible();
});

test("corriger une exigence puis qualifier l'offre", async ({ page }) => {
  const preferred = page.getByRole("region", { name: "Critères souhaités" });
  await preferred.getByRole("button", { name: /dbt/ }).click();
  await preferred.getByRole("button", { name: "Corriger" }).click();
  await preferred.getByLabel("Importance").selectOption("mandatory");
  await preferred.getByRole("button", { name: "Enregistrer" }).click();
  await expect(page.getByRole("region", { name: "Exigences obligatoires" }).getByRole("button", { name: /dbt\s*corrigé/ })).toBeVisible();

  await page.getByRole("button", { name: "Qualifier l'offre" }).click();
  await expect(page.getByText("Qualifiée", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Écarter l'offre" })).toBeVisible();
});
