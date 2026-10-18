import { expect, test } from "@playwright/test";
import { boardUser, signIn } from "./fixtures";

// Parcours qui modifie des données persistantes : une seconde tentative partirait d'un autre état.
test.describe.configure({ retries: 0 });

test("colonnes du Kanban : renommer, masquer, le clavier saute les colonnes masquées, puis rétablir", async ({ page }, testInfo) => {
  await signIn(page, boardUser(testInfo.project.name));
  await page.goto("/candidatures");
  const card = page.getByRole("listitem", { name: /^Senior Data Engineer/ });
  await expect(page.getByRole("region", { name: "À analyser" }).getByRole("listitem")).toHaveCount(1);

  await page.getByText("Personnaliser les colonnes").click();
  await page.getByLabel("Nom affiché pour « Nouvelle offre »").fill("Envoyée");
  await page.getByRole("button", { name: "Enregistrer les colonnes" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Deux colonnes" })).toHaveText("Deux colonnes portent le même nom : « Envoyée ».");

  // La saisie est conservée après l'erreur.
  await page.getByLabel("Nom affiché pour « Nouvelle offre »").fill("Repérées");
  for (const step of ["Offre qualifiée", "CV à adapter", "À analyser"]) await page.getByRole("checkbox", { name: `Afficher « ${step} »` }).uncheck();
  await page.getByRole("button", { name: "Enregistrer les colonnes" }).click();
  await expect(page.getByText("Colonnes enregistrées.")).toBeVisible();

  await expect(page.getByRole("region", { name: "Repérées" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Offre qualifiée" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "CV à adapter" })).toHaveCount(0);
  // Masquée mais non vide : la colonne reste affichée, signalée comme telle.
  await expect(page.getByRole("region", { name: "À analyser" })).toContainText("masquée");

  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("region", { name: "Prête à envoyer" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "À analyser" })).toHaveCount(0);
  await expect(page.getByText(/déplacée vers Prête à envoyer\./)).toBeAttached();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("region", { name: "Repérées" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByText(/déplacée vers Repérées\./)).toBeAttached();
  await page.reload();
  await expect(page.getByRole("region", { name: "Repérées" }).getByRole("listitem")).toHaveCount(1);

  await page.getByText("Personnaliser les colonnes").click();
  await page.getByRole("button", { name: "Rétablir les colonnes par défaut" }).click();
  await expect(page.getByRole("region", { name: "Nouvelle offre" }).getByRole("listitem")).toHaveCount(1);
  await expect(page.getByRole("region", { name: "Offre qualifiée" })).toBeVisible();
  await expect(page.getByLabel("Nom affiché pour « Nouvelle offre »")).toHaveValue("");
});
