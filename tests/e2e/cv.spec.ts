import { expect, test } from "@playwright/test";
import { analyzedOfferTitle, signIn } from "./fixtures";
import { drainPendingMatches } from "./worker";

const MISSION = "Développement et maintenance de 30 pipelines Python/SQL orchestrés par Airflow.";
const SUGGESTED = "Conception et maintenance de 30 pipelines Python et SQL orchestrés par Airflow.";

test("adapter le CV : suggestions sourcées, contrôle des faits, recontrôle, finalisation et export", async ({ page }, testInfo) => {
  const title = analyzedOfferTitle(testInfo.project.name);
  page.on("dialog", (d) => void d.accept());
  await signIn(page);
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: title, exact: true }).click();
  await page.getByRole("link", { name: "CV personnalisé" }).click();
  await expect(page.getByRole("heading", { name: "Adapter mon CV" })).toBeVisible();

  // Suggestions : une fidèle à décider, une bloquée par le garde-fou avec sa raison.
  const suggestions = page.getByRole("region", { name: "Suggestions" });
  await expect(suggestions.getByText(/aucun fournisseur IA n'est autorisé à recevoir ton CV/i)).toBeVisible();
  const pending = suggestions.getByRole("listitem", { name: "Reformulation — À décider" });
  const blocked = suggestions.getByRole("listitem", { name: "Reformulation — Bloquée" });
  await expect(blocked).toContainText("« dbt » est ajouté sans preuve dans la source");
  await expect(pending).toContainText("Couvre : Python et SQL");

  const bullet = page.getByRole("textbox", { name: "Puce 1 de Lumio", exact: true });
  await expect(bullet).toHaveValue(MISSION);
  await pending.getByRole("button", { name: "Accepter" }).click();
  await expect(bullet).toHaveValue(SUGGESTED);
  await suggestions.getByRole("listitem", { name: "Reformulation — Acceptée" }).getByRole("button", { name: "Annuler la décision" }).click();
  await expect(bullet).toHaveValue(MISSION);

  // Contrôle des faits en direct : un chiffre inventé est signalé, le recontrôle attend l'enregistrement.
  await bullet.fill("Développement de 45 pipelines Python.");
  const facts = page.getByRole("region", { name: "Contrôle des faits" });
  await expect(facts).toContainText("Lumio : le chiffre « 45 » n'apparaît pas dans la source.");
  await expect(page.getByRole("button", { name: "Recontrôler cette version" })).toBeDisabled();
  await expect(suggestions.getByText("Enregistre tes modifications pour décider des suggestions.")).toBeVisible();
  await page.getByRole("button", { name: "Rétablir" }).click();
  await expect(facts).not.toContainText("« 45 »");

  // Le CV laisse de côté l'expérience Sencia : le recontrôle doit le montrer.
  await page.getByRole("checkbox", { name: /Data Engineer · Sencia/ }).uncheck();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText(/^Enregistré le/)).toBeVisible();

  await page.getByRole("button", { name: "Recontrôler cette version" }).click();
  await page.waitForURL(/\/cv\/recontrole\//);
  await expect(page.getByText("Recontrôle en cours…")).toBeVisible();
  expect(await drainPendingMatches()).toBeGreaterThan(0);
  await page.reload();

  await expect(page.getByRole("heading", { name: "Ce que le recruteur verra" })).toBeVisible();
  const worse = page.getByRole("region", { name: "Moins bien couvertes" });
  await expect(worse).toContainText("Expérience en data");
  await expect(page.getByRole("region", { name: "Vérification des faits" })).toContainText("✓ Dates, intitulés et entreprises viennent du profil maître");
  const score = page.getByRole("region", { name: "Score avant et après" });
  await expect(score).toContainText("points par rapport au profil maître complet");

  const download = page.waitForEvent("download");
  await page.getByRole("link", { name: "Télécharger le PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/^CV-.*-Nordwave-v1\.pdf$/);

  await page.getByRole("button", { name: "Finaliser cette version" }).click();
  await expect(page.getByText("Finalisée", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Finaliser cette version" })).toHaveCount(0);

  // L'éditeur garde l'historique : la version finalisée est listée et comparable au brouillon.
  await page.getByRole("link", { name: "CV personnalisé" }).click();
  const versions = page.getByRole("region", { name: "Versions" });
  await expect(versions.getByRole("row", { name: /v1 Finalisée/ })).toBeVisible();
  await versions.getByRole("link", { name: "Comparer au brouillon" }).click();
  await expect(page.getByRole("region", { name: "Comparaison" })).toContainText("Aucune différence.");
});
