import { expect, test } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs, resetDemo, warmUpRoutes } from "./helpers";

// La cuenta demo del cliente (Sofía Martínez) arranca con 180 puntos. "10% de descuento" cuesta 100.
const SALDO_INICIAL = 180;
const COSTO_DESCUENTO = 100;

test.describe("canje de puntos de fidelidad", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * COLD_ROUTE_TIMEOUT_MS);
    await warmUpRoutes(browser);
    await resetDemo(browser);
  });

  test("el cliente canjea una recompensa y se descuenta el saldo", async ({ browser }) => {
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

      cliente.page.once("dialog", (dialog) => dialog.accept());
      await cliente.page.getByRole("button", { name: "Canjear: 10% de descuento" }).click();

      await expect(saldo).toHaveText(String(SALDO_INICIAL - COSTO_DESCUENTO));
      // Con 80 puntos ya no alcanza para ninguna recompensa.
      await expect(cliente.page.getByRole("button", { name: /^Canjear:/ })).toHaveCount(0);

      // El movimiento queda en el historial con signo negativo.
      const movimiento = cliente.page.locator("div.neumorphic", { hasText: "Canje: 10% de descuento" }).last();
      await expect(movimiento).toContainText(`-${COSTO_DESCUENTO}`);
    } finally {
      await cliente.context.close();
    }
  });

  test("el servidor rechaza un canje sin saldo suficiente o con recompensa inválida", async ({ browser }) => {
    const cliente = await loginAs(browser, "cliente");
    try {
      // El saldo quedó en 80 por el test anterior: el postre (200) no alcanza.
      const sinSaldo = await cliente.context.request.post("/api/client/rewards", { data: { rewardId: "postre" } });
      expect(sinSaldo.status()).toBe(409);

      const invalida = await cliente.context.request.post("/api/client/rewards", { data: { rewardId: "no-existe" } });
      expect(invalida.status()).toBe(400);

      const anonimo = await browser.newContext();
      try {
        const res = await anonimo.request.post("/api/client/rewards", { data: { rewardId: "descuento" } });
        expect(res.ok()).toBe(false);
      } finally {
        await anonimo.close();
      }
    } finally {
      await cliente.context.close();
    }
  });
});
