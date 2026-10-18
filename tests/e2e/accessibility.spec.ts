import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { analyzedOfferTitle, applicationOfferTitle, signIn } from "./fixtures";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page: Page, name: string) {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const summary = violations.map((v) => `${name} · ${v.id} (${v.impact}) : ${v.help} → ${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(" | ")}`);
  return summary;
}

test("connexion : aucune violation WCAG 2.2 AA détectée", async ({ page }) => {
  await page.goto("/login");
  expect(await audit(page, "connexion")).toEqual([]);
});

test("écrans du parcours critique : aucune violation WCAG 2.2 AA détectée", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const project = testInfo.project.name;
  const found: string[] = [];
  await signIn(page);
  found.push(...(await audit(page, "tableau de bord")));
  await page.goto("/?periode=7j");
  found.push(...(await audit(page, "tableau de bord 7 jours")));

  await page.goto("/offres");
  found.push(...(await audit(page, "offres")));
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: analyzedOfferTitle(project), exact: true }).click();
  await page.waitForURL(/\/offres\/[0-9a-f-]{36}$/);
  found.push(...(await audit(page, "analyse d'offre")));
  const offerUrl = page.url();

  await page.goto(`${offerUrl}/matching`);
  found.push(...(await audit(page, "matching")));
  await page.goto(`${offerUrl}/cv`);
  found.push(...(await audit(page, "éditeur de CV")));

  // Offre au CV finalisé : recontrôle et versions.
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: applicationOfferTitle(project), exact: true }).click();
  await page.waitForURL(/\/offres\/[0-9a-f-]{36}$/);
  await page.getByRole("link", { name: "CV personnalisé" }).click();
  await page.getByRole("link", { name: "Recontrôle" }).first().click();
  await page.waitForURL(/recontrole/);
  found.push(...(await audit(page, "recontrôle")));

  // Candidature créée sur l'offre analysée (le parcours de candidature utilise l'autre offre).
  await page.goto(offerUrl);
  await page.getByRole("button", { name: "Suivre la candidature" }).click();
  await page.waitForURL(/\/candidatures\/[0-9a-f-]{36}$/);
  found.push(...(await audit(page, "fiche candidature")));
  for (const vue of ["", "?vue=tableau", "?vue=calendrier", "?vue=entreprise"]) {
    await page.goto(`/candidatures${vue}`);
    found.push(...(await audit(page, `candidatures ${vue || "kanban"}`)));
  }
  // Lecteur d'écran : la carte annonce aussi le score (et la prochaine action quand il y en a une).
  await page.goto("/candidatures");
  const title = analyzedOfferTitle(project).replace(/[()]/g, "\\$&");
  await expect(page.getByRole("listitem", { name: new RegExp(`^${title}, Nordwave — .* · score \\d+ sur 100`) })).toBeVisible();
  await page.getByText("Personnaliser les colonnes").click();
  found.push(...(await audit(page, "réglage des colonnes")));

  await page.goto("/profil");
  found.push(...(await audit(page, "profil maître")));
  await page.goto("/reglages/ia");
  found.push(...(await audit(page, "fournisseurs IA")));
  await page.goto("/reglages/confidentialite");
  found.push(...(await audit(page, "confidentialité")));
  await page.goto("/reglages/sauvegardes");
  found.push(...(await audit(page, "sauvegardes")));

  expect(found).toEqual([]);
});

test("lecteur d'écran : titre de chaque page, symboles décoratifs masqués", async ({ page }, testInfo) => {
  await signIn(page);
  await expect(page).toHaveTitle("Tableau de bord · JobPilot");
  await page.goto("/offres?q=Nordwave");
  await page.getByRole("link", { name: analyzedOfferTitle(testInfo.project.name), exact: true }).click();
  await page.waitForURL(/\/offres\/[0-9a-f-]{36}$/);
  const offerUrl = page.url();
  // ✓ ○ ◐ ● ★ seraient lus « coche », « cercle blanc »… : le sens est porté par le libellé voisin.
  for (const path of ["/matching", "/cv"]) {
    await page.goto(`${offerUrl}${path}`);
    await expect(page.locator("main")).toBeVisible();
    expect(await page.locator("main").ariaSnapshot(), path).not.toMatch(/[✓○◐●★]/);
  }
  await page.goto("/candidatures?vue=tableau");
  expect(await page.locator("main").ariaSnapshot()).not.toMatch(/[✓○◐●★]/);
});
