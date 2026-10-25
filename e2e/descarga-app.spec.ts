import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";

// En un Android, el repartidor ve el botón para bajar la APK y el archivo se sirve como instalable.
test.use({
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
});

test("el repartidor en Android puede descargar la app", async ({ browser, request }) => {
  const repartidor = await loginAs(browser, "repartidor");
  try {
    await repartidor.page.goto("/repartidor");
    const link = repartidor.page.getByRole("link", { name: /Descargar app para Android/ });
    await expect(link).toBeVisible();
    const href = await link.getAttribute("href");
    expect(href).toBe("/descargas/dely-repartidor.apk");

    const res = await request.head(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toBe("application/vnd.android.package-archive");
  } finally {
    await repartidor.context.close();
  }
});
