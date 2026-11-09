import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test.describe("medios de pago de Fudo y entregas en el mapa (demo)", () => {
  test("la pantalla de Fudo ofrece los medios reales con su id", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "admin");
    try {
      await page.goto("/admin/fudo");
      const tarjeta = page.getByLabel("Medio de Fudo para Tarjeta");
      await expect(tarjeta).toHaveValue("6");
      await expect(tarjeta.locator("option", { hasText: "Payway" })).toHaveCount(1);
      const medios = page.getByTestId("medio-fudo");
      await expect(medios).toHaveCount(13);
      await expect(medios.filter({ hasText: "Online Pedidos Ya" })).toContainText("10");
      await expect(medios.filter({ hasText: "ECHEQ" })).toContainText("15");
      await expect(medios.filter({ hasText: "Efectivo Rappi" })).toContainText("Inactivo");
    } finally {
      await context.close();
    }
  });

  test("el mapa lista lo entregado hoy aunque no tenga repartidor", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "admin");
    try {
      await page.goto("/admin/mapa");
      await expect(page.getByText(/^Entregados( \(|$)/).last()).toBeVisible();
      await expect(page.getByRole("link", { name: /Marta Gómez/ })).toContainText("Sin repartidor");
      await expect(page.getByRole("link", { name: /Marta Gómez/ })).toContainText("En el mapa");
      await expect(page.getByRole("link", { name: /Cliente PedidosYa/ }).first()).toContainText("Sin ubicación");
      await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
