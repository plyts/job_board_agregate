import { expect, test } from "@playwright/test";
import { applicationOfferTitle, signIn } from "./fixtures";

test("suivre une candidature : Kanban au clavier, envoi confirmé avec fichier figé, historique", async ({ page }, testInfo) => {
  const title = applicationOfferTitle(testInfo.project.name);
  await signIn(page);
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("button", { name: "Suivre la candidature" }).click();
  await page.waitForURL(/\/candidatures\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("✓ Prête à envoyer")).toBeVisible();
  await expect(page.getByRole("region", { name: "Documents" })).toContainText("Version 1 · finalisée");

  // Kanban : ← → déplacent la carte sélectionnée ; « Envoyée » exige la confirmation.
  await page.getByLabel("Navigation principale").getByRole("link", { name: "Candidatures" }).click();
  const card = page.getByRole("listitem", { name: new RegExp(`^${title.replace(/[()]/g, "\\$&")}`) });
  // Le compte e2e est partagé entre bureau et mobile : on cible la carte de ce projet.
  const pattern = new RegExp(title.replace(/[()]/g, "\\$&"));
  await expect(page.getByRole("region", { name: "Prête à envoyer" }).getByRole("listitem", { name: pattern })).toBeVisible();
  await card.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("alert").filter({ hasText: "Confirme d'abord l'envoi" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("region", { name: "CV à adapter" }).getByRole("listitem", { name: pattern })).toBeVisible();
  await expect(card).toBeFocused();
  // Second geste sans attendre la confirmation du premier : les deux sont appliqués dans l'ordre.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("region", { name: "Prête à envoyer" }).getByRole("listitem", { name: pattern })).toBeVisible();
  await expect(page.getByText(/déplacée vers Prête à envoyer\./)).toBeAttached();
  await page.reload();
  await expect(page.getByRole("region", { name: "Prête à envoyer" }).getByRole("listitem", { name: pattern })).toBeVisible();

  // Fiche : confirmation d'envoi explicite, fichier figé et haché.
  await card.focus();
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/candidatures\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "J'ai envoyé ma candidature" }).click();
  await page.getByLabel("Canal").selectOption({ label: "E-mail au recruteur" });
  await expect(page.getByRole("radio", { name: "CV personnalisé v1 (PDF)" })).toBeChecked();
  await page.getByRole("button", { name: "Confirmer l'envoi" }).click();
  const send = page.getByRole("region", { name: "Envoi" });
  await expect(send.getByRole("status")).toContainText("Envoi confirmé le");
  await expect(send).toContainText("E-mail au recruteur");
  await expect(page.getByText("→ Envoyée")).toBeVisible();
  const docs = page.getByRole("region", { name: "Documents" });
  await expect(docs).toContainText(/sha256 [0-9a-f]{8}…[0-9a-f]{4}/);
  await expect(page.getByRole("region", { name: "Historique" })).toContainText("Envoi confirmé par toi");
  await expect(page.getByRole("region", { name: "Historique" })).toContainText("Statut : Prête à envoyer → CV à adapter");

  const download = page.waitForEvent("download");
  await docs.getByRole("link", { name: "Télécharger le fichier envoyé" }).click();
  expect((await download).suggestedFilename()).toMatch(/^CV-.*-v1\.pdf$/);

  // Une candidature envoyée ne revient pas avant l'envoi.
  await page.getByRole("region", { name: "Étape" }).getByLabel("Étape").selectOption({ label: "Prête à envoyer" });
  await page.getByRole("button", { name: "Déplacer" }).click();
  await expect(page.getByRole("region", { name: "Étape" }).getByRole("alert")).toContainText("déjà envoyée");

  if (testInfo.project.name === "desktop") {
    // Glisser-déposer à la souris.
    await page.getByLabel("Navigation principale").getByRole("link", { name: "Candidatures" }).click();
    const sent = page.getByRole("region", { name: "Envoyée" }).getByRole("listitem", { name: pattern });
    await sent.dragTo(page.getByRole("region", { name: "Relance" }));
    await expect(page.getByRole("region", { name: "Relance" }).getByRole("listitem", { name: pattern })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("region", { name: "Relance" })).toContainText(title);
  } else {
    await page.getByRole("region", { name: "Étape" }).getByLabel("Étape").selectOption({ label: "Entretien RH" });
    await page.getByRole("button", { name: "Déplacer" }).click();
    await expect(page.getByText("● Entretien RH")).toBeVisible();
  }

  // Vue tableau.
  await page.goto("/candidatures?vue=tableau");
  await expect(page.getByRole("row", { name: pattern })).toContainText("E-mail au recruteur");
});
