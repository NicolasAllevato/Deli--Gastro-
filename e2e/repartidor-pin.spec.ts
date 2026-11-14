import { test, expect } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs } from "./helpers";

// El admin da de alta a un repartidor con su PIN, y el repartidor entra solo con el PIN.
test.describe("repartidores con PIN", () => {
  // Rutas nuevas: en `next dev` la primera visita compila la página y sus APIs.
  test.setTimeout(180_000);
  test("el admin da de alta un repartidor y ve el PIN una sola vez", async ({ browser }) => {
    const admin = await loginAs(browser, "admin");
    try {
      await admin.page.goto("/admin/repartidores", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(admin.page.getByRole("listitem").filter({ hasText: "Diego Rojas" })).toBeVisible({ timeout: COLD_ROUTE_TIMEOUT_MS });

      await admin.page.getByLabel("Nombre").fill("Prueba E2E");
      await admin.page.getByLabel("PIN (opcional)").fill("567890");
      await admin.page.getByRole("button", { name: "Dar de alta" }).click();

      await expect(admin.page.getByRole("status").filter({ hasText: "Prueba E2E" })).toContainText("567890", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(admin.page.getByRole("listitem").filter({ hasText: "Prueba E2E" })).toContainText("Activo");

      // El mismo PIN no se puede repetir.
      await admin.page.getByLabel("Nombre").fill("Otro");
      await admin.page.getByLabel("PIN (opcional)").fill("567890");
      await admin.page.getByRole("button", { name: "Dar de alta" }).click();
      await expect(admin.page.getByText("Ese PIN ya lo usa otro repartidor")).toBeVisible();
    } finally {
      await admin.context.close();
    }
  });

  test("el repartidor entra con su PIN desde la app", async ({ browser }) => {
    const context = await browser.newContext();
    const page = await context.newPage();
    try {
      await page.goto("/repartidor", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(page).toHaveURL(/\/login\?redirectTo=%2Frepartidor/);
      await expect(page.getByRole("tab", { name: "Repartidor" })).toHaveAttribute("aria-selected", "true");

      const pin = page.getByLabel("PIN de repartidor");
      await pin.fill("000000");
      await expect(page.getByText("PIN incorrecto.")).toBeVisible({ timeout: COLD_ROUTE_TIMEOUT_MS });

      await pin.fill("123456");
      await expect(page).toHaveURL(/\/(repartidor|aceptar-terminos)/, { timeout: COLD_ROUTE_TIMEOUT_MS });
      if (page.url().includes("aceptar-terminos")) {
        // Espera a que cargue el estado (en la demo puede venir ya aceptado de otro test).
        await expect(page.getByRole("button", { name: /Falta aceptar|Ingresar/ })).toBeVisible({ timeout: COLD_ROUTE_TIMEOUT_MS });
        for (const doc of ["Acepto los Términos y condiciones", "Acepto la Política de privacidad"]) {
          const button = page.getByRole("button", { name: doc });
          if (await button.count()) {
            await button.click();
            await expect(button).toHaveCount(0);
          }
        }
        await page.getByRole("button", { name: "Ingresar" }).click();
      }
      await expect(page).toHaveURL(/\/repartidor$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(page.getByRole("heading", { name: "Mis entregas" })).toBeVisible();
    } finally {
      await context.close();
    }
  });
});
