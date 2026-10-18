import { expect, test } from "@playwright/test";
import { deletableUser, signIn } from "./fixtures";

test("mon compte : export complet puis suppression définitive confirmée", async ({ page }, testInfo) => {
  const account = deletableUser(testInfo.project.name);
  await signIn(page, account);
  await page.getByLabel("Navigation principale").getByRole("link", { name: "Mon compte" }).click();
  await expect(page.getByRole("heading", { name: "Mon compte", exact: true })).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger l'export" }).click();
  expect((await download).suggestedFilename()).toMatch(/^jobpilot-export-\d{4}-\d{2}-\d{2}\.zip$/);

  const zone = page.getByRole("region", { name: "Supprimer mon compte" });
  await zone.getByLabel("E-mail du compte").fill(account.email);
  await zone.getByLabel("Mot de passe").fill("pas le bon mot de passe");
  await zone.getByRole("checkbox").check();
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
  await expect(zone.getByRole("alert")).toContainText("rien n'a été supprimé");

  await zone.getByLabel("Mot de passe").fill(account.password);
  await zone.getByRole("button", { name: "Supprimer définitivement mon compte" }).click();
  await page.waitForURL(/\/login\?compte=supprime/);
  await expect(page.getByText("Ton compte et toutes ses données ont été supprimés.")).toBeVisible();

  await page.getByLabel("E-mail").fill(account.email);
  await page.getByLabel("Mot de passe").fill(account.password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.locator("#login-error")).toBeVisible();
});
