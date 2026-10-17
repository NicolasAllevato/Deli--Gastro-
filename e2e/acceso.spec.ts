import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

// El guard de `src/proxy.ts` es la barrera de acceso por rol: se prueba desde el navegador.
test.describe("control de acceso por rol", () => {
  for (const ruta of ["/admin", "/admin/tablero", "/repartidor", "/cliente/pedidos"]) {
    test(`sin sesión, ${ruta} redirige al login`, async ({ page }) => {
      await page.goto(ruta);
      await expect(page).toHaveURL(/\/login/);
    });
  }

  test("las APIs protegidas responden 401 sin sesión", async ({ request }) => {
    for (const ruta of ["/api/orders", "/api/whatsapp/config", "/api/couriers"]) {
      const res = await request.get(ruta);
      expect(res.status(), ruta).toBe(401);
    }
  });

  test("un cliente no puede entrar al panel del admin", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "cliente");
    try {
      await page.goto("/admin");
      await expect(page).not.toHaveURL(/\/admin(\/|$)/);
      const res = await context.request.get("/api/orders");
      expect(res.ok()).toBe(false);
    } finally {
      await context.close();
    }
  });

  test("un repartidor no puede entrar al panel del admin", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "repartidor");
    try {
      await page.goto("/admin");
      await expect(page).not.toHaveURL(/\/admin(\/|$)/);
    } finally {
      await context.close();
    }
  });

  test("el admin sí entra a su tablero", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "admin");
    try {
      await page.goto("/admin/tablero");
      await expect(page).toHaveURL(/\/admin\/tablero/);
    } finally {
      await context.close();
    }
  });
});
