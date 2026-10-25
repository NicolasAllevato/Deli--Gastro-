import { expect, test } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs } from "./helpers";

// Primer ingreso: antes del portal hay que aceptar Términos y Privacidad, cada uno con su botón,
// y la aceptación aparece en el panel del admin.
test.describe("aceptación de términos y privacidad", () => {
  test("un usuario nuevo acepta los dos documentos por separado y entra a su portal", async ({ browser }) => {
    test.setTimeout(180_000);
    const { context, page } = await loginAs(browser, "cliente", { acceptLegal: false });
    try {
      await page.goto("/cliente", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(page).toHaveURL(/\/aceptar-terminos\?redirectTo=%2Fcliente/);

      const ingresar = page.getByRole("button", { name: /Falta aceptar|Ingresar/ });
      await expect(ingresar).toBeDisabled();

      await page.getByRole("button", { name: "Acepto los Términos y condiciones" }).click();
      await expect(page.getByText(/Aceptado el/)).toHaveCount(1);
      await expect(ingresar).toBeDisabled();

      await page.getByRole("button", { name: "Acepto la Política de privacidad" }).click();
      await expect(page.getByText(/Aceptado el/)).toHaveCount(2);

      await page.getByRole("button", { name: "Ingresar" }).click();
      await expect(page).toHaveURL(/\/cliente$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
    } finally {
      await context.close();
    }

    // Otro navegador del mismo usuario (sin la marca de aceptación): ya aceptó todo, así que "Ingresar" entra.
    const otro = await loginAs(browser, "cliente", { acceptLegal: false });
    try {
      await otro.page.goto("/cliente", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(otro.page).toHaveURL(/\/aceptar-terminos/);
      await otro.page.getByRole("button", { name: "Ingresar" }).click({ timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(otro.page).toHaveURL(/\/cliente$/, { timeout: COLD_ROUTE_TIMEOUT_MS });
    } finally {
      await otro.context.close();
    }

    const admin = await loginAs(browser, "admin");
    try {
      await admin.page.goto("/admin/legal", { timeout: COLD_ROUTE_TIMEOUT_MS });
      const row = admin.page.getByRole("row", { name: /cliente@deli-gastro\.com/ });
      await expect(row).toContainText("Confirmado");
    } finally {
      await admin.context.close();
    }
  });
});
