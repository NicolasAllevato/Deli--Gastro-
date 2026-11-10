import { defineConfig, devices } from "@playwright/test";

// Línea base de UI (docs/baseline-ui-2026-11.md): capturas y auditoría axe, fuera de `npm run e2e` y de la CI.
//   npm run e2e:visual          -> compara contra los baselines de esta máquina
//   npm run e2e:visual:update   -> los regenera
//   npm run e2e:a11y            -> genera test-results/a11y/axe-report.{json,md}; nunca falla por violaciones
// Los baselines llevan {platform} en la ruta: solo sirven en el mismo sistema operativo.
const PORT = Number(process.env.E2E_PORT ?? 5291);
process.env.E2E_PORT = String(PORT);
const BASE_URL = `http://localhost:${PORT}`;
const TIME_ZONE = "America/Argentina/Buenos_Aires";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{arg}{ext}",
  expect: {
    timeout: 20_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      stylePath: "./e2e/support/visual.css",
    },
  },
  use: {
    baseURL: BASE_URL,
    locale: "es-AR",
    timezoneId: TIME_ZONE,
    trace: "off",
    screenshot: "off",
  },
  projects: [
    { name: "visual", testMatch: "visual.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "a11y", testMatch: "a11y.spec.ts", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
    command: "npm run demo",
    url: `${BASE_URL}/login`,
    env: {
      DEMO_PORT: String(PORT),
      E2E_SIN_RATE_LIMIT: "1",
      TZ: TIME_ZONE,
      // La hora del servidor queda fija: los datos demo se calculan relativos a "ahora".
      NODE_OPTIONS: "--require ./e2e/support/freeze-time.cjs",
    },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
