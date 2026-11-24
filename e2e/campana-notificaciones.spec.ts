import { expect, test } from "@playwright/test";
import { crearPedidoComoCliente, loginAs } from "./helpers";

test("la campana del admin abre el desplegable con los pedidos nuevos", async ({ browser }) => {
  const { page: cliente } = await loginAs(browser, "cliente");
  const { codigo } = await crearPedidoComoCliente(cliente);

  const { page } = await loginAs(browser, "admin");
  await page.goto("/admin/tablero");
  const campana = page.getByRole("button", { name: /^Notificaciones/ });
  await expect(campana).toHaveAttribute("aria-expanded", "false");
  await campana.click();
  const panel = page.getByRole("region", { name: "Notificaciones" });
  await expect(panel).toBeVisible();
  await expect(panel.getByText(/Pedido nuevo #/).first()).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "e2e/__screenshots__/campana-abierta.png" });
  // El código del pedido recién creado aparece en la lista.
  await expect(panel.getByText(new RegExp(codigo.replace("#", "").slice(0, 8), "i"))).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(campana).toHaveAttribute("aria-expanded", "false");
});
