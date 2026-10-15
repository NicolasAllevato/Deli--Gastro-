import { expect, test } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, crearPedidoComoCliente, loginAs, resetDemo, warmUpRoutes } from "./helpers";

// El cliente califica un pedido entregado una sola vez; una nota baja pide un comentario.
test.describe("reseña de un pedido entregado", () => {
  test.beforeAll(async ({ browser }) => {
    test.setTimeout(5 * COLD_ROUTE_TIMEOUT_MS);
    await warmUpRoutes(browser);
    await resetDemo(browser);
  });

  test("el cliente reseña un pedido entregado y no puede reseñarlo de nuevo", async ({ browser }) => {
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");

    try {
      // Un pedido entregado y sin reseña ofrece el enlace "Reseñar" en el historial.
      await cliente.page.goto("/cliente/pedidos");
      const enlace = cliente.page.getByRole("link", { name: /^Reseñar/ }).first();
      await expect(enlace).toBeVisible();
      const href = await enlace.getAttribute("href");
      const orderId = href?.split("/").pop() ?? "";
      expect(orderId).toMatch(/^[0-9a-f-]{36}$/);
      await enlace.click();

      await expect(cliente.page.getByRole("heading", { name: "Calificá tu pedido" })).toBeVisible();
      await cliente.page.getByRole("button", { name: "Calificar con 2 estrellas" }).click();
      await cliente.page.getByLabel("¿Qué podemos mejorar?").fill("Llegó tibio, pero el trato fue bueno.");
      await cliente.page.getByRole("button", { name: "Enviar Comentarios" }).click();
      await expect(cliente.page.getByRole("heading", { name: "¡Gracias por tu reseña!" })).toBeVisible();

      // El seguimiento ya marca el pedido como calificado.
      await cliente.page.goto(`/cliente/pedidos/${orderId}`, { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(cliente.page.getByText("Ya calificaste este pedido")).toBeVisible();
      await expect(cliente.page.getByRole("link", { name: "Calificar pedido" })).toHaveCount(0);

      // El servidor rechaza una segunda reseña del mismo pedido.
      const repetida = await cliente.context.request.post("/api/reviews", { data: { orderId, rating: 5 } });
      expect(repetida.status()).toBe(409);
    } finally {
      await cliente.context.close();
    }
  });

  test("no se puede reseñar un pedido que todavía no fue entregado", async ({ browser }) => {
    test.setTimeout(3 * COLD_ROUTE_TIMEOUT_MS);
    const cliente = await loginAs(browser, "cliente");
    try {
      // Un pedido recién creado sigue en "Recibidos".
      const { id } = await crearPedidoComoCliente(cliente.page);
      const res = await cliente.context.request.post("/api/reviews", { data: { orderId: id, rating: 5 } });
      expect(res.status()).toBe(409);
    } finally {
      await cliente.context.close();
    }
  });
});
