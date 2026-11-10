import type { Browser, BrowserContext, Page } from "@playwright/test";
import { essentialOnly, serializeConsentCookie } from "../../src/lib/consent/consentCore";
import { THEME_STORAGE_KEY, type AppTheme } from "../../src/lib/theme/themeConfig";
import { COLD_ROUTE_TIMEOUT_MS, loginAs, type DemoRole } from "../helpers";

export interface UiRoute {
  readonly slug: string;
  readonly path: string;
  readonly role: DemoRole | null;
  /** Ancho en el que se audita con axe: el uso principal de cada portal. */
  readonly auditWidth: number;
}

export const UI_ROUTES: readonly UiRoute[] = [
  { slug: "login", path: "/login", role: null, auditWidth: 375 },
  { slug: "cliente", path: "/cliente", role: "cliente", auditWidth: 375 },
  { slug: "cliente-pedidos", path: "/cliente/pedidos", role: "cliente", auditWidth: 375 },
  { slug: "cliente-carrito", path: "/cliente/carrito", role: "cliente", auditWidth: 375 },
  { slug: "admin-ejecutivo", path: "/admin/ejecutivo", role: "admin", auditWidth: 1280 },
  { slug: "admin-pedidos", path: "/admin/pedidos", role: "admin", auditWidth: 1280 },
  { slug: "admin-mapa", path: "/admin/mapa", role: "admin", auditWidth: 1280 },
  { slug: "repartidor", path: "/repartidor", role: "repartidor", auditWidth: 375 },
];

export const UI_THEMES: readonly AppTheme[] = ["light", "dark"];
export const UI_VIEWPORTS = [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

const FIXED_TIME = new Date("2026-11-10T15:00:00-03:00");
const SETTLE_TIMEOUT_MS = 5_000;
const NETWORK_IDLE_TIMEOUT_MS = 15_000;
// PNG transparente de 1x1: reemplaza tiles y avatares externos.
const BLANK_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function openContext(browser: Browser, role: DemoRole | null): Promise<{ context: BrowserContext; page: Page }> {
  if (role) return loginAs(browser, role);
  const context = await browser.newContext();
  const [name, ...value] = serializeConsentCookie(essentialOnly()).split(";")[0].split("=");
  await context.addCookies([{ name, value: value.join("="), domain: "localhost", path: "/" }]);
  return { context, page: await context.newPage() };
}

function isLocal(url: URL): boolean {
  return url.hostname === "localhost";
}

/** Espera el fin de las animaciones finitas y de las fuentes, con un tope para no colgar la corrida. */
async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: NETWORK_IDLE_TIMEOUT_MS }).catch(() => undefined);
  await page.evaluate(async (limit) => {
    const finite = document
      .getAnimations()
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map((animation) => animation.finished.catch(() => undefined));
    const timeout = new Promise((resolve) => setTimeout(resolve, limit));
    await Promise.race([Promise.all([...finite, document.fonts.ready]), timeout]);
  }, SETTLE_TIMEOUT_MS);
}

/** Abre una ruta con tema, ancho y reloj fijos y sin red externa. El contexto lo cierra quien llama. */
export async function openUiRoute(
  browser: Browser,
  route: UiRoute,
  theme: AppTheme,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const { context, page } = await openContext(browser, route.role);
  await context.addInitScript(([key, value]) => window.localStorage.setItem(key, value), [THEME_STORAGE_KEY, theme]);
  await context.route(
    (url) => !isLocal(url),
    (external) =>
      external.request().resourceType() === "image"
        ? external.fulfill({ status: 200, contentType: "image/png", body: BLANK_PNG })
        : external.abort(),
  );
  await page.clock.setFixedTime(FIXED_TIME);
  await page.setViewportSize(viewport);
  await page.goto(route.path, { timeout: COLD_ROUTE_TIMEOUT_MS, waitUntil: "load" });
  await settle(page);
  return { context, page };
}
