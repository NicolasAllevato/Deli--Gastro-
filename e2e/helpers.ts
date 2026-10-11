import type { Browser, BrowserContext, Page } from "@playwright/test";

export type DemoRole = "admin" | "cliente" | "repartidor";

const DEMO_PASSWORD = "demo1234";

/** Abre un contexto de navegador ya autenticado con una de las cuentas del modo demo. */
export async function loginAs(browser: Browser, role: DemoRole): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const res = await context.request.post("/api/demo/session", {
    data: { email: `${role}@deli-gastro.com`, password: DEMO_PASSWORD },
  });
  if (!res.ok()) throw new Error(`No se pudo iniciar sesión como ${role}: ${res.status()}`);
  return { context, page: await context.newPage() };
}

/** Tiempo para la primera visita a una ruta: `next dev` la compila bajo demanda. */
export const COLD_ROUTE_TIMEOUT_MS = 90_000;

const ROUTES_BY_ROLE: Record<DemoRole, readonly string[]> = {
  cliente: ["/cliente", "/cliente/carrito", "/cliente/pedidos"],
  admin: ["/admin/tablero"],
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
    } finally {
      await context.close();
    }
  }
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
