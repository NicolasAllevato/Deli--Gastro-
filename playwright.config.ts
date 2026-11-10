import { defineConfig, devices } from "@playwright/test";

// Los E2E corren contra el modo demo (datos en memoria, sin Supabase ni servicios externos).
// Puerto propio para no chocar con `npm run demo` (5178) ni con otras sesiones.
const PORT = Number(process.env.E2E_PORT ?? 5290);
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // Capturas y axe tienen su propia config (playwright.visual.config.ts): las capturas dependen del SO
  // y los baselines commiteados son de Windows, así que no pueden correr en la CI (Linux).
  testIgnore: ["**/visual.spec.ts", "**/a11y.spec.ts"],
  // El almacén demo es un único estado compartido en memoria: los tests van en serie.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  forbidOnly: Boolean(process.env.CI),
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : [["list"]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    locale: "es-AR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npm run demo",
    url: `${BASE_URL}/login`,
    env: { DEMO_PORT: String(PORT), E2E_SIN_RATE_LIMIT: "1" },
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
