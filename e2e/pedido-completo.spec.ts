import { expect, test } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs, resetDemo, warmUpRoutes } from "./helpers";

// Flujo crítico: el cliente pide, el local lo prepara y lo despacha, el repartidor lo entrega
// y el cliente lo ve entregado. Cubre las tres sesiones y los cambios de estado entre ellas.
test.describe("pedido de punta a punta", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * COLD_ROUTE_TIMEOUT_MS);
    await warmUpRoutes(browser);
    await resetDemo(browser);
  });

  test("cliente pide → admin prepara y despacha → repartidor entrega → cliente lo ve entregado", async ({ browser }) => {
    // La ruta del seguimiento tiene el id en la URL y no se puede precalentar: se compila acá.
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");
    const admin = await loginAs(browser, "admin");
    const repartidor = await loginAs(browser, "repartidor");

    try {
      // 1. El cliente arma el carrito con el primer producto del menú.
      await cliente.page.goto("/cliente");
      await cliente.page.getByRole("button", { name: /^Agregar .+ al carrito$/ }).first().click();

      // 2. Checkout: elige una dirección de ejemplo cubierta y confirma.
      await cliente.page.goto("/cliente/carrito");
      await cliente.page.getByRole("button", { name: "Av. Corrientes 1234, CABA" }).click();
      const confirmar = cliente.page.getByRole("button", { name: /^Confirmar pedido/ });
      await expect(confirmar).toBeEnabled();
      await confirmar.click();

      // 3. Llega al seguimiento del pedido recién creado.
      await expect(cliente.page).toHaveURL(/\/cliente\/pedidos\/[^/]+$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
      const titulo = cliente.page.getByRole("heading", { level: 2, name: /^Pedido / });
      await expect(titulo).toBeVisible();
      const codigo = (await titulo.innerText()).replace(/^Pedido\s+/, "").trim();
      expect(codigo.length).toBeGreaterThan(0);
      await expect(cliente.page.getByText(/Llega en unos \d+ min/)).toBeVisible();

      // 4. El admin lo ve en "Recibidos", lo acepta y lo deja listo para enviar.
      await admin.page.goto("/admin/tablero");
      const tarjetaAdmin = admin.page.locator("article", { has: admin.page.getByRole("link", { name: codigo }) });
      await expect(tarjetaAdmin).toBeVisible();
      await tarjetaAdmin.getByRole("button", { name: "Aceptar Pedido" }).click();
      await tarjetaAdmin.getByRole("button", { name: "Listo para Enviar" }).click();

      // 5. El repartidor lo toma, sale con el pedido y lo entrega.
      await repartidor.page.goto("/repartidor");
      // Desde el navegador no se toma la ubicación: se ofrece la app Android.
      await expect(repartidor.page.getByRole("heading", { name: "Bajá la app del repartidor" })).toBeVisible();
      const tarjetaRepartidor = repartidor.page.locator("article", { hasText: codigo });
      await expect(tarjetaRepartidor).toBeVisible();
      await tarjetaRepartidor.getByRole("button", { name: "Tomar pedido" }).click();
      await tarjetaRepartidor.getByRole("button", { name: "Salí con el pedido" }).click();
      await expect(tarjetaRepartidor.getByText(/Saliste hace \d+ min/)).toBeVisible();
      await tarjetaRepartidor.getByRole("button", { name: "Marcar como entregado" }).click();

      // 6. El cliente ve el pedido entregado sin recargar (el seguimiento se actualiza solo).
      await expect(cliente.page.getByText("Entregado", { exact: true })).toBeVisible({ timeout: 30_000 });
      await expect(cliente.page.getByText(/Llega en unos \d+ min/)).toHaveCount(0);
    } finally {
      await Promise.all([cliente.context.close(), admin.context.close(), repartidor.context.close()]);
    }
  });
});
