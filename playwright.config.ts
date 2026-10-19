import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);
process.env.DATABASE_URL ??= "postgres://postgres@localhost:5432/jobpilot_e2e";

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  // Les scénarios partagent le même compte : exécution en série pour éviter le verrouillage croisé.
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    launchOptions: process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : undefined,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    // Fausse clé Groq : sert uniquement à afficher un fournisseur actif ; le serveur web n'appelle jamais le modèle.
    // Clé de chiffrement de test ; API des sources dirigées vers le faux serveur lancé par global-setup.
    env: {
      DATABASE_URL: process.env.DATABASE_URL,
      COOKIE_INSECURE: "1",
      GROQ_API_KEY: "cle-factice-e2e",
      GROQ_MODEL: "modele-e2e",
      JOBPILOT_SECRETS_KEY: Buffer.alloc(32, 9).toString("base64"),
      FRANCE_TRAVAIL_TOKEN_URL: "http://127.0.0.1:3199/token",
      FRANCE_TRAVAIL_API_URL: "http://127.0.0.1:3199/ft",
      ADZUNA_API_URL: "http://127.0.0.1:3199/adzuna",
    },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
