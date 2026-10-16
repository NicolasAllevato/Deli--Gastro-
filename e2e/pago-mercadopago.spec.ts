import { expect, test, type Locator, type Page } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs, resetDemo, warmUpRoutes } from "./helpers";

// Cobro digital en modo demo: el simulador de Mercado Pago reemplaza al checkout real pero pasa por la
// misma lógica que el webhook. El pedido recién existe cuando el pago se aprueba.
test.describe.configure({ mode: "serial" });

/** `next dev` hidrata las pantallas en frío con retraso: un clic dado antes se pierde. Se espera la marca de hidratación. */
async function clickWhenHydrated(page: Page, button: Locator): Promise<void> {
  await expect(page.locator('[data-hydrated="true"]')).toBeVisible({ timeout: COLD_ROUTE_TIMEOUT_MS });
  await button.click();
}

async function pagarConMercadoPago(page: Page): Promise<string> {
  await page.goto("/cliente");
  await page.getByRole("button", { name: /^Agregar .+ al carrito$/ }).first().click();

  await page.goto("/cliente/carrito");
  await page.getByRole("button", { name: "Av. Corrientes 1234, CABA" }).click();
  await page.getByRole("radio", { name: "Mercado Pago" }).check({ force: true });

  const pagar = page.getByRole("button", { name: /^Pagar con Mercado Pago/ });
  await expect(pagar).toBeEnabled();
  // Un solo clic: este crea la intención de pago y no se puede repetir.
  await pagar.click();
  await expect(page).toHaveURL(/\/demo\/mercadopago\/[^/]+$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
  return new URL(page.url()).pathname.split("/").pop() ?? "";
}

test.describe("pago con Mercado Pago", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * COLD_ROUTE_TIMEOUT_MS);
    await warmUpRoutes(browser);
    await resetDemo(browser);
  });

  test("el pedido no existe hasta que el pago se aprueba y entonces llega al tablero", async ({ browser }) => {
    test.setTimeout(4 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");
    const admin = await loginAs(browser, "admin");

    try {
      const intentId = await pagarConMercadoPago(cliente.page);
      await expect(cliente.page.getByText("Simulador de Mercado Pago")).toBeVisible();

      // Mientras el pago no se aprueba, la cocina no ve nada de este pedido.
      await admin.page.goto("/admin/tablero");
      const antes = await admin.page.locator("article").count();

      await clickWhenHydrated(cliente.page, cliente.page.getByRole("button", { name: "Aprobar pago" }));

      // El cliente termina en el seguimiento de su pedido ya creado.
      await expect(cliente.page).toHaveURL(/\/cliente\/pedidos\/[^/]+$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
      const titulo = cliente.page.getByRole("heading", { level: 2, name: /^Pedido / });
      await expect(titulo).toBeVisible();
      const codigo = (await titulo.innerText()).replace(/^Pedido\s+/, "").trim();

      await admin.page.goto("/admin/tablero");
      await expect(admin.page.locator("article", { has: admin.page.getByRole("link", { name: codigo }) })).toBeVisible();
      expect(await admin.page.locator("article").count()).toBe(antes + 1);

      // Volver a aprobar el mismo pago no duplica el pedido.
      const again = await cliente.context.request.post(`/api/demo/payments/${intentId}`, { data: { outcome: "approved" } });
      expect(again.ok()).toBe(true);
      expect(((await again.json()) as { result: string }).result).toBe("already_settled");
    } finally {
      await Promise.all([cliente.context.close(), admin.context.close()]);
    }
  });

  test("un pago rechazado no crea el pedido y se puede cancelar", async ({ browser }) => {
    test.setTimeout(4 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");

    try {
      await pagarConMercadoPago(cliente.page);
      await clickWhenHydrated(cliente.page, cliente.page.getByRole("button", { name: "Rechazar pago" }));
      await expect(cliente.page).toHaveURL(/\/cliente\/pago\/[^/]+$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(cliente.page.getByText("Esperando tu pago")).toBeVisible({ timeout: COLD_ROUTE_TIMEOUT_MS });

      await clickWhenHydrated(cliente.page, cliente.page.getByRole("button", { name: "Cancelar este pago" }));
      await expect(cliente.page.getByText("Pago cancelado")).toBeVisible();
      await expect(cliente.page.getByRole("link", { name: "Volver al menú" })).toBeVisible();
    } finally {
      await cliente.context.close();
    }
  });

  test("el simulador no existe fuera del modo demo para ids inválidos", async ({ browser }) => {
    const cliente = await loginAs(browser, "cliente");
    try {
      const res = await cliente.context.request.post("/api/demo/payments/no-es-uuid", { data: { outcome: "approved" } });
      expect(res.status()).toBe(400);
    } finally {
      await cliente.context.close();
    }
  });
});
