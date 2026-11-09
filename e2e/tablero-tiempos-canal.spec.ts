import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

test("el tablero muestra el tiempo hasta el cierre por canal, rotulado como cierre", async ({ browser }) => {
  const { context, page } = await loginAs(browser, "admin");
  try {
    await page.goto("/admin/ejecutivo");
    const tabla = page.getByTestId("tiempos-canal");
    await expect(tabla.getByRole("heading", { name: "Tiempo hasta el cierre por canal" })).toBeVisible();
    await expect(tabla.getByRole("row", { name: /PedidosYa/ })).toContainText("Cierre en caja");
    await expect(tabla.getByRole("row", { name: /Rappi/ })).toContainText("min");
    await expect(tabla.getByRole("row", { name: "Fudo · Take away" })).toContainText("No medible");
  } finally {
    await context.close();
  }
});
