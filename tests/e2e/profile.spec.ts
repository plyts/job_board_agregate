import { expect, test } from "@playwright/test";
import { E2E_PROFILE_USER, signIn } from "./fixtures";
import { minimalPdf } from "../helpers/pdf";

// Les deux scénarios modifient le même profil : exécution dans l'ordre, sur un seul appareil.
test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "Parcours d'édition vérifié sur ordinateur");

test("saisir le profil, voir la règle des preuves, valider puis ouvrir une nouvelle version", async ({ page }) => {
  await signIn(page, E2E_PROFILE_USER);
  await page.getByRole("link", { name: "Profil maître" }).click();
  await expect(page.getByRole("heading", { name: "Aucun profil validé" })).toBeVisible();
  await page.getByRole("button", { name: "Saisir mon profil" }).click();
  await expect(page).toHaveURL(/\/profil\/brouillon$/);

  const identity = page.getByRole("region", { name: "Identité" });
  await identity.getByLabel("Nom complet").fill("Camille Martin");
  await identity.getByLabel("Titre professionnel").fill("Data Engineer");

  const experiences = page.getByRole("region", { name: "Expériences" });
  await experiences.getByRole("button", { name: "Ajouter une expérience" }).click();
  await experiences.getByLabel("Intitulé du poste").fill("Data Engineer");
  await experiences.getByLabel("Entreprise").fill("Lumio");
  await experiences.getByLabel("Début").fill("2023-09");
  await experiences.getByLabel("Poste actuel").check();
  await experiences.getByRole("button", { name: "Ajouter une mission ou une réalisation" }).click();
  await experiences.getByLabel("Description").fill("Développement de 30 pipelines Python orchestrés par Airflow.");

  const skills = page.getByRole("region", { name: "Compétences et preuves" });
  await skills.getByRole("button", { name: "Ajouter une compétence" }).click();
  await skills.getByLabel("Compétence").fill("Python");
  await skills.getByLabel("Niveau").selectOption("mastered");

  await page.getByRole("button", { name: "Valider cette version" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Validation impossible" })).toContainText(
    "« Python » : un niveau autre que « non confirmée » exige au moins une preuve.",
  );

  await skills.getByText(/Preuves \(0\)/).click();
  await skills.getByLabel("Data Engineer · Lumio").check();
  await page.getByRole("button", { name: "Valider cette version" }).click();

  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByText("Profil maître · version 1 · source de vérité")).toBeVisible();
  // Bonnes pratiques figées avec la version validée, et rappelées dans l'historique.
  const practices = page.getByRole("region", { name: "Bonnes pratiques du profil maître" });
  await expect(practices).toContainText("Rapport figé à la validation de la version 1");
  await expect(practices).toContainText("Verbe d'action en tête");
  await expect(page.getByText(/bonnes pratiques \d+\/100/)).toBeVisible();
  const skillsView = page.getByRole("region", { name: "Compétences et preuves" });
  await expect(skillsView.getByText("Maîtrisée")).toBeVisible();
  await expect(skillsView.getByText("Data Engineer · Lumio")).toBeVisible();

  await page.getByRole("button", { name: "Modifier le profil" }).click();
  await expect(page.getByText("Brouillon · version 2")).toBeVisible();
  await expect(page.getByRole("region", { name: "Identité" }).getByLabel("Nom complet")).toHaveValue("Camille Martin");
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Supprimer le brouillon" }).click();
  await expect(page).toHaveURL(/\/profil$/);
  await expect(page.getByText("version 1 · source de vérité")).toBeVisible();
});

test("importer un CV sans fournisseur autorisé pour les données personnelles", async ({ page }) => {
  await signIn(page, E2E_PROFILE_USER);
  await page.goto("/profil");
  await page
    .getByLabel("CV au format PDF ou DOCX (10 Mo maximum)")
    .setInputFiles({ name: "cv.pdf", mimeType: "application/pdf", buffer: minimalPdf(["Camille Martin, Data Engineer a Lyon.", "Lumio : 30 pipelines Python orchestres par Airflow.", "Master Informatique, Universite de Lyon."]) });
  await page.getByRole("button", { name: "Importer mon CV" }).click();
  await expect(page).toHaveURL(/\/profil\/brouillon$/);
  await expect(page.getByText("En file", { exact: true })).toBeVisible();
  await expect(page.getByText(/Aucun fournisseur IA n'est autorisé à recevoir ton CV/)).toBeVisible();
  await page.getByText("Texte extrait du CV").click();
  await expect(page.getByText(/30 pipelines Python/)).toBeVisible();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: "Supprimer le brouillon" }).click();
  await expect(page).toHaveURL(/\/profil$/);
});
