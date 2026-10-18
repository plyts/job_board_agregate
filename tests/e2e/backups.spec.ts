import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures";

test("sauvegardes : état de la planification et demande d'une sauvegarde au worker, sans doublon", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Navigation principale").getByRole("link", { name: "Sauvegardes" }).click();
  await expect(page.getByRole("heading", { name: "Sauvegardes", exact: true })).toBeVisible();

  // Aucun worker configuré pendant les tests : la planification est inactive et dit quoi renseigner.
  const planning = page.getByRole("region", { name: "Planification" });
  await expect(planning).toContainText("Inactive");
  await expect(planning).toContainText("BACKUP_DIR, BACKUP_PASSPHRASE");
  await expect(page.getByRole("region", { name: "Copie hors site" })).toContainText("Non configurée");

  // La demande part dans la file ; une seconde demande ne crée pas de doublon tant que la première attend.
  const now = page.getByRole("region", { name: "Sauvegarde à la demande" });
  await now.getByRole("button", { name: "Sauvegarder maintenant" }).click();
  await expect(now.getByText(/Sauvegarde demandée|Une sauvegarde est déjà en attente ou en cours\./)).toBeVisible();
  await now.getByRole("button", { name: "Sauvegarder maintenant" }).click();
  await expect(now.getByRole("alert")).toHaveText("Une sauvegarde est déjà en attente ou en cours.");
});
