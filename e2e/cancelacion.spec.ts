import { expect, test } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, crearPedidoComoCliente, loginAs, resetDemo, warmUpRoutes } from "./helpers";

// El cliente puede cancelar mientras el pedido siga "Recibidos" y dentro de la ventana configurada.
test.describe("cancelación del pedido por el cliente", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * COLD_ROUTE_TIMEOUT_MS);
    await warmUpRoutes(browser);
    await resetDemo(browser);
  });

  test("el cliente cancela un pedido recibido y el admin lo ve cancelado", async ({ browser }) => {
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");
    const admin = await loginAs(browser, "admin");

    try {
      const { codigo } = await crearPedidoComoCliente(cliente.page);
      await expect(cliente.page.getByText(/Llega en unos \d+ min/)).toBeVisible();

      // Cancela desde el seguimiento (la app pide confirmación con un diálogo nativo).
      cliente.page.once("dialog", (dialog) => dialog.accept());
      await cliente.page.getByRole("button", { name: "Cancelar pedido" }).click();

      await expect(cliente.page.getByText("Este pedido fue cancelado.")).toBeVisible();
      await expect(cliente.page.getByText(/Llega en unos \d+ min/)).toHaveCount(0);
      await expect(cliente.page.getByRole("button", { name: "Cancelar pedido" })).toHaveCount(0);

      // El admin lo ve en el historial filtrado por "Cancelados"...
      await admin.page.goto("/admin/pedidos?estado=Cancelado");
      const fila = admin.page.locator("tr", { hasText: codigo });
      await expect(fila).toBeVisible();
      await expect(fila.getByText("Cancelado", { exact: true })).toBeVisible();

      // ...y ya no figura entre los pedidos activos del tablero.
      await admin.page.goto("/admin/tablero");
      await expect(admin.page.getByRole("link", { name: codigo })).toHaveCount(0);
    } finally {
      await Promise.all([cliente.context.close(), admin.context.close()]);
    }
  });

  test("un pedido ya cancelado no se puede cancelar de nuevo", async ({ browser }) => {
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");
    try {
      const { id } = await crearPedidoComoCliente(cliente.page);
      const url = `/api/client/orders/${id}`;

      const primera = await cliente.context.request.patch(url, { data: { action: "cancel" } });
      expect(primera.ok()).toBe(true);

      const segunda = await cliente.context.request.patch(url, { data: { action: "cancel" } });
      expect(segunda.status()).toBe(409);
      expect(((await segunda.json()) as { error: string }).error).toMatch(/ya está cancelado/i);
    } finally {
      await cliente.context.close();
    }
  });
});
