import { expect, test } from "@playwright/test";
import { analyzedOfferTitle, signIn } from "./fixtures";

test("le matching explique le score, filtre par catégorie et recalcule avec d'autres poids", async ({ page }, testInfo) => {
  const title = analyzedOfferTitle(testInfo.project.name);
  await signIn(page);
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("link", { name: /Matching \d+\/100/ }).click();
  await expect(page.getByRole("heading", { name: "Pourquoi cette offre te correspond" })).toBeVisible();

  const score = page.getByRole("region", { name: "Score de compatibilité" });
  // Obligatoires (1 + 0,5) / 2 × 50, souhaités 0, expérience 15, conditions 0 → 52,5
  await expect(score.getByText("53", { exact: true })).toBeVisible();

  const summary = page.getByRole("region", { name: "En résumé" });
  await expect(summary).toContainText("Python et SQL");
  await expect(summary).toContainText("Présence sur site (incompatibilité potentielle)");
  await expect(summary).toContainText("salaire (non mentionné)");

  const details = page.getByRole("region", { name: "Exigence par exigence" });
  await details.getByRole("button", { name: /Partielle/ }).click();
  await expect(details.getByText("Kubernetes")).toBeVisible();
  await expect(details.getByText(/projet personnel ou académique/)).toBeVisible();
  await expect(details.getByText("Python et SQL")).toHaveCount(0);

  await score.getByText("Configurer les poids").click();
  await score.getByLabel("Critères souhaités").fill("0");
  await score.getByLabel("Conditions (lieu, contrat)").fill("0");
  await score.getByLabel("Séniorité et expérience").fill("0");
  await score.getByRole("button", { name: "Recalculer le score" }).click();
  await expect(score.getByText("75", { exact: true })).toBeVisible();
});
