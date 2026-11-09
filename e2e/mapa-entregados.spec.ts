import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const count = (page: Page, id: string) => page.getByTestId(id);
const pedido = (page: Page, nombre: string) => page.getByRole("link", { name: new RegExp(nombre) });

test.describe("mapa: entregados con filtros (demo)", () => {
  test("rango, canal, repartidor y sin ubicación", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "admin");
    try {
      await page.goto("/admin/mapa");
      await expect(pedido(page, "Marta Gómez")).toBeVisible();
      await expect(pedido(page, "Rappi Mes")).toHaveCount(0);

      // PedidosYa de la semana: cuenta, pero no tiene punto.
      await page.getByRole("button", { name: "7 días" }).click();
      await page.getByLabel("Canal").selectOption({ label: "PedidosYa" });
      await expect(pedido(page, "PedidosYa Semana")).toContainText("Sin ubicación");
      await expect(pedido(page, "PedidosYa Semana")).toContainText("PedidosYa");
      await expect(count(page, "entregados-en-mapa")).toHaveText("0");
      await expect(page.getByText(/no tienen dirección/)).toBeVisible();

      await page.getByLabel("Canal").selectOption({ label: "Rappi" });
      await expect(pedido(page, "PedidosYa Semana")).toHaveCount(0);
      await page.getByRole("button", { name: "30 días" }).click();
      await expect(pedido(page, "Rappi Mes")).toContainText("Sin ubicación");

      await page.getByLabel("Canal").selectOption({ label: "Morfy" });
      await expect(pedido(page, "Cliente Morfy Viejo")).toContainText("En el mapa");

      // La venta vieja sin hora de cierre se ubica por su fecha de creación.
      await page.getByLabel("Canal").selectOption({ label: "Delivery local" });
      await expect(pedido(page, "Historial Sin Cierre")).toContainText("Sin ubicación");
      await expect(pedido(page, "Historial Dirección Ambigua")).toContainText("Sin ubicación");
      await expect(pedido(page, "Historial Fuera De Rango")).toHaveCount(0);

      await page.getByLabel("Repartidor").selectOption({ label: "Nora Demo" });
      await expect(count(page, "entregados-total")).toHaveText("1");
      await expect(pedido(page, "Historial Local Ubicado")).toContainText("En el mapa");
      await expect(page.locator(".leaflet-marker-icon").first()).toBeVisible();

      await page.getByLabel("Canal").selectOption({ label: "Web / WhatsApp" });
      await expect(pedido(page, "Web Historial")).toContainText("Nora Demo");

      await page.getByLabel("Canal").selectOption({ label: "Delivery local" });
      await page.getByLabel("Repartidor").selectOption({ label: "Sin repartidor" });
      await expect(pedido(page, "Historial Sin Cierre")).toBeVisible();
      await expect(pedido(page, "Historial Local Ubicado")).toHaveCount(0);

      // Personalizado: el pedido de hace 45 días solo aparece si el rango lo cubre.
      const iso = (d: number) => {
        const t = new Date(Date.now() - d * 86_400_000);
        return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
      };
      await page.getByRole("button", { name: "Personalizado" }).click();
      await expect(page.getByText(/Elegí una fecha/)).toBeVisible();
      await page.getByLabel("Desde").fill(iso(47));
      await page.getByLabel("Hasta").fill(iso(43));
      await expect(pedido(page, "Historial Fuera De Rango")).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
