import { expect, test } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs, resetDemo, warmUpRoutes } from "./helpers";

// La cuenta demo del cliente (Sofía Martínez) arranca con 180 puntos. "10% de descuento" cuesta 100.
const SALDO_INICIAL = 180;
const COSTO_DESCUENTO = 100;

// Los tests comparten el estado de la demo (el saldo cambia de uno al siguiente): van en orden.
test.describe.configure({ mode: "serial" });

test.describe("canje de puntos de fidelidad", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * COLD_ROUTE_TIMEOUT_MS);
    await warmUpRoutes(browser);
    await resetDemo(browser);
  });

  let pedidoUrl = "";

  test("canjear lleva al carrito, aplica el descuento y cobra los puntos al confirmar", async ({ browser }) => {
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");

    try {
      await cliente.page.goto("/cliente/fidelidad");
      const saldo = cliente.page.locator("p.text-4xl");
      await expect(saldo).toHaveText(String(SALDO_INICIAL));

      // Con 180 puntos alcanza el descuento (100) y la bebida (150), pero no el postre (200).
      await expect(cliente.page.getByRole("button", { name: "Canjear: 10% de descuento" })).toBeVisible();
      await expect(cliente.page.getByRole("button", { name: "Canjear: Bebida gratis" })).toBeVisible();
      await expect(cliente.page.getByRole("button", { name: "Canjear: Postre gratis" })).toHaveCount(0);

      // Canjear no descuenta nada todavía: lleva al carrito con la recompensa elegida.
      await cliente.page.getByRole("button", { name: "Canjear: 10% de descuento" }).click();
      await expect(cliente.page).toHaveURL(/\/cliente\/carrito$/);
      await expect(cliente.page.getByText(/Elegiste .*10% de descuento/)).toBeVisible();

      // Arma el pedido con el primer producto del menú; la recompensa sigue elegida.
      await cliente.page.goto("/cliente");
      await cliente.page.getByRole("button", { name: /^Agregar .+ al carrito$/ }).first().click();
      await cliente.page.goto("/cliente/carrito");

      const canje = cliente.page.getByRole("region", { name: "Canje de puntos" });
      await expect(canje).toContainText("10% de descuento");
      await expect(cliente.page.getByText("Canje: 10% de descuento")).toBeVisible();

      await cliente.page.getByRole("button", { name: "Av. Corrientes 1234, CABA" }).click();
      const confirmar = cliente.page.getByRole("button", { name: /^Confirmar pedido/ });
      await expect(confirmar).toBeEnabled();
      await confirmar.click();

      await expect(cliente.page).toHaveURL(/\/cliente\/pedidos\/[^/]+$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
      pedidoUrl = new URL(cliente.page.url()).pathname;

      // Recién al confirmar se descuentan los puntos, y el movimiento queda en el historial.
      await cliente.page.goto("/cliente/fidelidad");
      await expect(saldo).toHaveText(String(SALDO_INICIAL - COSTO_DESCUENTO));
      const movimiento = cliente.page.locator("div.neumorphic", { hasText: "Canje: 10% de descuento" }).last();
      await expect(movimiento).toContainText(`-${COSTO_DESCUENTO}`);
    } finally {
      await cliente.context.close();
    }
  });

  test("cancelar el pedido con canje devuelve los puntos", async ({ browser }) => {
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    expect(pedidoUrl).not.toBe("");
    const cliente = await loginAs(browser, "cliente");

    try {
      await cliente.page.goto(pedidoUrl);
      cliente.page.once("dialog", (dialog) => dialog.accept());
      await cliente.page.getByRole("button", { name: "Cancelar pedido" }).click();
      await expect(cliente.page.getByText("Este pedido fue cancelado.")).toBeVisible();

      await cliente.page.goto("/cliente/fidelidad");
      await expect(cliente.page.locator("p.text-4xl")).toHaveText(String(SALDO_INICIAL));
      await expect(cliente.page.locator("div.neumorphic", { hasText: "Devolución" }).last()).toContainText(`+${COSTO_DESCUENTO}`);
    } finally {
      await cliente.context.close();
    }
  });

  // Las reglas de saldo, categoría y total esperado se prueban con datos reales en tests/orders-create.test.ts.
  test("el endpoint viejo que descontaba puntos sin dar nada a cambio ya no existe", async ({ browser }) => {
    const cliente = await loginAs(browser, "cliente");
    try {
      const res = await cliente.context.request.post("/api/client/rewards", { data: { rewardId: "descuento" } });
      expect(res.status()).toBe(404);
    } finally {
      await cliente.context.close();
    }
  });
});
