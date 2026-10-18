import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures";

test("confidentialité : masquage, consentements, conservation et droits sont expliqués", async ({ page }) => {
  await signIn(page);
  await page.getByLabel("Navigation principale").getByRole("link", { name: "Confidentialité" }).click();
  await expect(page.getByRole("heading", { name: "Confidentialité et RGPD" })).toBeVisible();

  const masking = page.getByRole("region", { name: "Masquage" });
  await expect(masking.getByRole("listitem").filter({ hasText: "nom et prénom" })).toContainText("[CANDIDAT]");
  await expect(masking.getByRole("listitem").filter({ hasText: "numéro de sécurité sociale" })).toContainText("[N° SÉCURITÉ SOCIALE]");

  // Groq est actif mais n'est pas autorisé pour les données personnelles : rien à consentir, rien ne lui est envoyé.
  // Les matchings des autres scénarios passent par le modèle local factice du worker de test : aucun transfert.
  await expect(page.getByRole("region", { name: "Consentements" }).getByRole("status")).toContainText("Aucun fournisseur externe");
  const transfers = page.getByRole("region", { name: "Transferts" });
  await expect(transfers).toContainText("Hors Union européenne");
  await expect(transfers).not.toContainText("Groq");

  const retention = page.getByRole("region", { name: "Durées de conservation" });
  await expect(retention.getByRole("row", { name: /CV importé/ })).toContainText("30 jours");

  const rights = page.getByRole("region", { name: "Tes droits" });
  await expect(rights.getByRole("link", { name: "exporter toutes tes données" })).toHaveAttribute("href", "/reglages/compte");
  await expect(rights.getByRole("link", { name: "cnil.fr/fr/plaintes" })).toBeVisible();
});
