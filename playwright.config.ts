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
    env: { DATABASE_URL: process.env.DATABASE_URL, COOKIE_INSECURE: "1" },
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
