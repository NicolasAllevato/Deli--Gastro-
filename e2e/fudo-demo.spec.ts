import { expect, test } from "@playwright/test";
import type { BrowserContext } from "@playwright/test";
import { COLD_ROUTE_TIMEOUT_MS, loginAs } from "./helpers";

interface ProductRow {
  name: string;
  image_url: string;
  description: string;
  price: number | string;
  is_active: boolean;
  fudo_id: number | null;
}

async function products(context: BrowserContext): Promise<ProductRow[]> {
  const res = await context.request.get("/api/products");
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { products: ProductRow[] }).products;
}

const find = (rows: ProductRow[], name: string) => rows.find((p) => p.name === name);

// Fudo simulado del modo demo: el flujo completo "cambia algo en Fudo -> sincronizo -> se ve en la app".
test.describe("Fudo en el modo demo", () => {
  test("simular cambios en Fudo, sincronizar y ver el efecto en Productos", async ({ browser }) => {
    // Recorre dos pantallas que `next dev` compila en frío la primera vez.
    test.setTimeout(240_000);
    const { context, page } = await loginAs(browser, "admin");
    try {
      const antes = await products(context);
      expect(find(antes, "Pizza Margarita")?.price).toEqual(expect.anything());
      expect(Number(find(antes, "Pizza Margarita")?.price)).toBe(12000);
      expect(find(antes, "Hamburguesa Bacon")).toBeUndefined();

      await page.goto("/admin/fudo", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await expect(page.getByText("Modo demo: Fudo simulado")).toBeVisible({ timeout: COLD_ROUTE_TIMEOUT_MS });

      // Primera sincronización: trae precios, crea 2 productos nuevos y vincula los manuales por nombre.
      await page.getByRole("button", { name: "Sincronizar catálogo ahora" }).click();
      await expect(page.getByText(/Catálogo sincronizado: 2 nuevos/)).toBeVisible();

      const trasSync = await products(context);
      expect(Number(find(trasSync, "Pizza Margarita")?.price)).toBe(12900);
      expect(find(trasSync, "Hamburguesa Bacon")?.fudo_id).not.toBeNull();
      expect(find(trasSync, "Papas Fritas con Cheddar")?.fudo_id).not.toBeNull();
      expect(find(trasSync, "Extra cheddar")).toBeUndefined();

      // Un cambio de precios hecho "en Fudo" llega con la siguiente sincronización.
      const clasicaAntes = Number(find(trasSync, "Hamburguesa Clásica")?.price);
      const cambio = page.waitForResponse((r) => r.url().includes("/api/demo/fudo/change"));
      await page.getByRole("button", { name: "Subir precios 10 %" }).click();
      expect((await cambio).status()).toBe(200);
      await expect(page.getByText(/Subió un 10/)).toBeVisible();
      await page.getByRole("button", { name: "Sincronizar catálogo ahora" }).click();
      await expect(page.getByText(/Catálogo sincronizado: 0 nuevos, 4 actualizados/)).toBeVisible();
      expect(Number(find(await products(context), "Hamburguesa Clásica")?.price)).toBeGreaterThan(clasicaAntes);

      // En Productos, un plato de Fudo no se puede editar en nombre y precio.
      await page.goto("/admin/productos", { timeout: COLD_ROUTE_TIMEOUT_MS });
      await page.getByRole("button", { name: "Editar Pizza Margarita" }).click();
      await expect(page.getByText(/Este producto viene de Fudo/)).toBeVisible();
      await expect(page.getByLabel("Nombre del Producto")).toBeDisabled();
      await expect(page.getByLabel("Precio ($)")).toBeDisabled();
      await expect(page.getByLabel("Descripción")).toBeEnabled();
    } finally {
      // Deja el demo como estaba: otros tests dependen de los precios del seed.
      await context.request.post("/api/demo/reset");
      await context.close();
    }
  });

  test("la API rechaza editar el precio de un producto de Fudo y deja editar la descripción", async ({ browser }) => {
    const { context } = await loginAs(browser, "admin");
    try {
      const margarita = find(await products(context), "Pizza Margarita") as ProductRow & { id: string };
      const soloPrecio = await context.request.patch("/api/products", { data: { id: margarita.id, price: 1 } });
      expect(soloPrecio.status()).toBe(409);

      const descripcion = await context.request.patch("/api/products", { data: { id: margarita.id, price: 1, description: "Nueva" } });
      expect(descripcion.ok()).toBe(true);
      const despues = find(await products(context), "Pizza Margarita");
      expect(Number(despues?.price)).toBe(12000);
      expect(despues?.description).toBe("Nueva");
      // Un PATCH parcial no pisa la foto de ejemplo.
      expect(despues?.image_url).toBe(margarita.image_url);
      expect(margarita.image_url).not.toBe("");
    } finally {
      await context.request.post("/api/demo/reset");
      await context.close();
    }
  });
});
