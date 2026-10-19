import { expect, test } from "@playwright/test";
import { signIn, sourcesUser } from "./fixtures";

// Parcours qui modifie des données persistantes : une seconde tentative partirait d'un autre état.
test.describe.configure({ retries: 0 });

test("sources : connexion testée, recherche combinée, import, offre à compléter, recherche enregistrée", async ({ page }, testInfo) => {
  page.on("dialog", (d) => void d.accept());
  await signIn(page, sourcesUser(testInfo.project.name));
  await page.getByLabel("Navigation principale").getByRole("link", { name: "Sources" }).click();
  await expect(page.getByRole("heading", { name: "Sources", exact: true })).toBeVisible();
  await expect(page.getByText("Il ne te demande jamais tes mots de passe LinkedIn", { exact: false })).toBeVisible();

  // Identifiants refusés : rien n'est enregistré ; identifiants valides : connexion testée puis chiffrée.
  const ft = page.getByRole("region", { name: "France Travail" });
  await ft.getByLabel("Identifiant client (client_id)").fill("mauvais-client");
  await ft.getByLabel("Clé secrète (client_secret)").fill("secret");
  await ft.getByRole("button", { name: "Connecter et tester" }).click();
  await expect(ft.getByRole("alert")).toContainText("France Travail refuse les identifiants", { timeout: 20_000 });
  await expect(ft.getByLabel("Identifiant client (client_id)")).toHaveValue("mauvais-client");
  await ft.getByLabel("Identifiant client (client_id)").fill("client-e2e");
  await ft.getByLabel("Clé secrète (client_secret)").fill("secret");
  await ft.getByRole("button", { name: "Connecter et tester" }).click();
  await expect(ft.getByText("France Travail est connecté.")).toBeVisible({ timeout: 20_000 });
  await expect(ft.getByText("Connectée", { exact: true })).toBeVisible();

  const adzuna = page.getByRole("region", { name: "Adzuna" });
  await adzuna.getByLabel("app_id").fill("app");
  await adzuna.getByLabel("app_key").fill("fausse");
  await adzuna.getByRole("button", { name: "Connecter et tester" }).click();
  await expect(adzuna.getByRole("alert")).toContainText("refuse l'accès", { timeout: 20_000 });

  // Recherche combinée, résultats fusionnés et importables.
  await page.getByLabel("Navigation principale").getByRole("link", { name: "Recherche" }).click();
  await page.getByLabel("Mots-clés").fill("data engineer, ingénieur données");
  await page.getByLabel("Lieu").fill("Lyon");
  await page.getByRole("checkbox", { name: "CDI" }).check();
  await page.getByRole("button", { name: "Rechercher maintenant" }).click();
  await page.waitForURL(/\/recherche\?run=/);
  const results = page.getByRole("region", { name: "Résultats" });
  await expect(results.getByRole("heading", { name: "2 résultats" })).toBeVisible();
  const first = results.getByRole("listitem", { name: "Ingénieur données (H/F)" });
  await expect(first).toContainText("France Travail");
  await expect(first).toContainText("Texte complet");
  await expect(results.getByRole("listitem", { name: "Data Engineer junior" })).toContainText("Extrait");
  await results.getByRole("button", { name: "Tout sélectionner" }).click();
  await results.getByRole("button", { name: "Importer la sélection (2)" }).click();
  await expect(results.getByRole("status")).toHaveText("2 offres importées, dont 1 à compléter.");
  await expect(first.getByRole("link", { name: "Déjà dans tes offres" })).toBeVisible();

  // Offre arrivée avec un extrait : le texte collé l'envoie en analyse.
  await results.getByRole("listitem", { name: "Data Engineer junior" }).getByRole("link", { name: "Déjà dans tes offres" }).click();
  const complete = page.getByRole("region", { name: "Compléter l'offre" });
  await expect(page.getByText("Texte à compléter", { exact: true })).toBeVisible();
  await expect(page.getByText(/Trouvée sur : France Travail/)).toBeVisible();
  await complete.getByLabel("Texte de l'annonce").fill(
    "Data Engineer junior en alternance chez Sencia à Villeurbanne. Vous participez à la construction de pipelines Python et SQL, encadré par l'équipe data.",
  );
  await complete.getByRole("button", { name: "Enregistrer et analyser" }).click();
  await expect(page.getByText("En file", { exact: true })).toBeVisible();
  await expect(complete).toHaveCount(0);

  // Recherche enregistrée.
  await page.goto("/recherche");
  await page.getByLabel("Mots-clés").fill("data engineer");
  await page.getByText("Enregistrer cette recherche").click();
  await page.getByLabel("Nom").fill("Data à Lyon");
  await page.getByRole("button", { name: "Enregistrer la recherche" }).click();
  await expect(page.getByText("Recherche « Data à Lyon » enregistrée")).toBeVisible();
  const saved = page.getByRole("region", { name: "Recherches enregistrées" });
  await expect(saved.getByRole("listitem").filter({ hasText: "Data à Lyon" })).toContainText("toutes les 6 h");
});
