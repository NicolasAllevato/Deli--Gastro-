import { expect } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { DEMO_LEGAL_COOKIE, LEGAL_BUNDLE_VERSION } from "../src/lib/legal/documents";
import { essentialOnly, serializeConsentCookie } from "../src/lib/consent/consentCore";

export type DemoRole = "admin" | "cliente" | "repartidor";

const DEMO_PASSWORD = "demo1234";

interface LoginOptions {
  /** Por defecto la cuenta ya aceptó Términos y Privacidad; false para probar el primer ingreso. */
  acceptLegal?: boolean;
}

/**
 * Abre un contexto de navegador ya autenticado con una de las cuentas del modo demo. También deja
 * elegido el consentimiento de cookies, para que el banner no tape botones en los tests.
 */
export async function loginAs(
  browser: Browser,
  role: DemoRole,
  { acceptLegal = true }: LoginOptions = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const res = await context.request.post("/api/demo/session", {
    data: { email: `${role}@deli-gastro.com`, password: DEMO_PASSWORD },
  });
  if (!res.ok()) throw new Error(`No se pudo iniciar sesión como ${role}: ${res.status()}`);

  const base = new URL(String(process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5290}`));
  const consent = serializeConsentCookie(essentialOnly()).split(";")[0].split("=");
  await context.addCookies([
    { name: consent[0], value: consent.slice(1).join("="), domain: base.hostname, path: "/" },
    ...(acceptLegal ? [{ name: DEMO_LEGAL_COOKIE, value: LEGAL_BUNDLE_VERSION, domain: base.hostname, path: "/" }] : []),
  ]);
  return { context, page: await context.newPage() };
}

/** Tiempo para la primera visita a una ruta: `next dev` la compila bajo demanda. */
export const COLD_ROUTE_TIMEOUT_MS = 90_000;

/** Cualquier UUID sirve: solo hace falta que Next compile la ruta dinámica. */
const WARM_UP_ORDER_ID = "00000000-0000-4000-8000-000000000000";

const ROUTES_BY_ROLE: Record<DemoRole, readonly string[]> = {
  cliente: [
    "/cliente",
    "/cliente/carrito",
    "/cliente/pedidos",
    "/cliente/fidelidad",
    `/cliente/resenas/${WARM_UP_ORDER_ID}`,
  ],
  admin: ["/admin/tablero", "/admin/pedidos"],
  repartidor: ["/repartidor"],
};

/**
 * Visita una vez las rutas del flujo para que el servidor de desarrollo las compile antes
 * de los pasos con límites de tiempo ajustados. Sin esto, el primer test es lento y frágil.
 */
export async function warmUpRoutes(browser: Browser): Promise<void> {
  for (const role of Object.keys(ROUTES_BY_ROLE) as DemoRole[]) {
    const { context, page } = await loginAs(browser, role);
    try {
      for (const route of ROUTES_BY_ROLE[role]) {
        await page.goto(route, { timeout: COLD_ROUTE_TIMEOUT_MS, waitUntil: "domcontentloaded" });
      }
      if (role === "cliente") await warmUpClientApis(context);
    } finally {
      await context.close();
    }
  }
}

/**
 * Las APIs de escritura del cliente también se compilan al primer uso. Se llaman con datos que
 * el servidor rechaza (pedido inexistente, recompensa inválida) para no alterar el estado.
 */
async function warmUpClientApis(context: BrowserContext): Promise<void> {
  const timeout = COLD_ROUTE_TIMEOUT_MS;
  await context.request.patch(`/api/client/orders/${WARM_UP_ORDER_ID}`, { data: { action: "cancel" }, timeout });
  await context.request.post("/api/reviews", { data: { orderId: WARM_UP_ORDER_ID, rating: 5 }, timeout });
  await context.request.post("/api/client/rewards", { data: { rewardId: "no-existe" }, timeout });
}

/** Vuelve a los datos de ejemplo originales para que cada archivo parta de un estado conocido. */
export async function resetDemo(browser: Browser): Promise<void> {
  const context = await browser.newContext();
  try {
    const res = await context.request.post("/api/demo/reset");
    if (!res.ok()) throw new Error(`No se pudo reiniciar la demo: ${res.status()}`);
  } finally {
    await context.close();
  }
}

/**
 * Arma un pedido de delivery como cliente (primer producto del menú, dirección de ejemplo cubierta)
 * y deja la página en el seguimiento. Devuelve el código visible (#XXXXXXXX) y el id de la URL.
 */
export async function crearPedidoComoCliente(page: Page): Promise<{ codigo: string; id: string }> {
  await page.goto("/cliente");
  await page.getByRole("button", { name: /^Agregar .+ al carrito$/ }).first().click();

  await page.goto("/cliente/carrito");
  await page.getByRole("button", { name: "Av. Corrientes 1234, CABA" }).click();
  const confirmar = page.getByRole("button", { name: /^Confirmar pedido/ });
  await expect(confirmar).toBeEnabled();
  await confirmar.click();

  await expect(page).toHaveURL(/\/cliente\/pedidos\/[^/]+$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
  const titulo = page.getByRole("heading", { level: 2, name: /^Pedido / });
  await expect(titulo).toBeVisible();
  const codigo = (await titulo.innerText()).replace(/^Pedido\s+/, "").trim();
  const id = new URL(page.url()).pathname.split("/").pop() ?? "";
  expect(codigo.length).toBeGreaterThan(0);
  return { codigo, id };
}
