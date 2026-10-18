import { expect, test } from "@playwright/test";
import { signIn } from "./fixtures";

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function offerText(id: string) {
  return `Data Engineer ${id}
Ondine Data recrute un ou une Data Engineer à Lyon pour industrialiser ses pipelines.
Missions : concevoir des flux Python et SQL orchestrés par Airflow, fiabiliser l'entrepôt BigQuery.
Profil : 3 ans d'expérience minimum, anglais professionnel.`;
}

test.beforeEach(async ({ page }) => {
  await signIn(page);
});

test("importer une offre par texte, la retrouver dans la liste et détecter le doublon", async ({ page }) => {
  const id = stamp();
  await page.getByRole("link", { name: "Offres" }).click();
  await expect(page.getByRole("heading", { name: "Importer une offre" })).toBeVisible();

  await page.getByRole("tab", { name: "Texte collé" }).click();
  await page.getByLabel("Texte de l'annonce").fill(offerText(id));
  await page.getByLabel("URL d'origine (recommandée)").fill(`https://exemple.fr/offres/${id}?utm_source=e2e`);
  await page.getByRole("button", { name: "Analyser" }).click();

  await expect(page).toHaveURL(/\/offres\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: `Data Engineer ${id}` })).toBeVisible();
  await expect(page.getByText("En file", { exact: true })).toBeVisible();
  await expect(page.getByText("fiabiliser l'entrepôt BigQuery")).toBeVisible();
  await expect(page.getByRole("link", { name: "Voir l'annonce originale" })).toHaveAttribute("href", `https://exemple.fr/offres/${id}?utm_source=e2e`);

  await page.getByRole("link", { name: "Offres", exact: true }).first().click();
  await page.getByRole("searchbox").fill(id);
  await page.getByRole("button", { name: "Filtrer" }).click();
  await expect(page.getByRole("link", { name: `Data Engineer ${id}` })).toBeVisible();

  await page.getByRole("tab", { name: "Texte collé" }).click();
  await page.getByLabel("Texte de l'annonce").fill(offerText(id).toUpperCase());
  await page.getByRole("button", { name: "Analyser" }).click();
  await expect(page.getByText("Cette offre est déjà dans ta liste.")).toBeVisible();
  await page.getByRole("link", { name: "Ouvrir l'offre existante" }).click();
  await expect(page.getByRole("heading", { name: `Data Engineer ${id}` })).toBeVisible();
});

test("une URL non récupérable bascule vers le texte collé en gardant l'URL", async ({ page }) => {
  await page.goto("/offres");
  await page.getByLabel("URL de l'annonce").fill("https://www.linkedin.com/jobs/view/123");
  await page.getByRole("button", { name: "Importer et analyser" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "interdisent la récupération automatique" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Texte collé" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByLabel("URL d'origine (recommandée)")).toHaveValue("https://www.linkedin.com/jobs/view/123");
});

test("une offre inconnue ou d'un autre compte renvoie une page introuvable", async ({ page }) => {
  await page.goto("/offres/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();
});
