import { expect, test } from "@playwright/test";
import { signIn, triageOfferTitle, triageUser } from "./fixtures";

test("à traiter : offres classées par score, scores manquants demandés, qualifier et écarter", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  await signIn(page, triageUser(project));
  await page.getByRole("region", { name: "À faire maintenant" }).getByRole("link", { name: "Trier" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "À traiter" })).toBeVisible();

  const list = page.getByRole("region", { name: /offres? à décider/ }).getByRole("listitem");
  await expect(list).toHaveCount(3);
  await expect(list.nth(0)).toContainText(triageOfferTitle(project, "haut"));
  await expect(list.nth(0)).toContainText("83 sur 100");
  await expect(list.nth(1)).toContainText(triageOfferTitle(project, "bas"));
  await expect(list.nth(2)).toContainText("Pas de score");

  // L'offre analysée avant tout matching : son score est demandé au worker.
  await page.getByRole("button", { name: "Calculer les scores" }).click();
  await expect(list.nth(2)).toContainText("Score en cours");
  await expect(page.getByRole("button", { name: "Calculer les scores" })).toHaveCount(0);

  await list.filter({ hasText: triageOfferTitle(project, "bas") }).getByRole("button", { name: "Écarter" }).click();
  await expect(list).toHaveCount(2);
  await list.filter({ hasText: triageOfferTitle(project, "haut") }).getByRole("button", { name: "Qualifier" }).click();
  await expect(list).toHaveCount(1);
  await expect(page.getByRole("link", { name: triageOfferTitle(project, "sans") })).toBeVisible();
});
