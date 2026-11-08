import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

const BASE = String(process.env.E2E_BASE_URL ?? `http://localhost:${process.env.E2E_PORT ?? 5290}`);
const SAME_ORIGIN = { origin: new URL(BASE).origin };

const CREDENTIALS = { appId: "123456789", configId: "1553288184524169", appSecret: "secreto-demo", coexistence: "1" };
const COEXISTENCE_SIGNUP = { mode: "coexistence", code: "codigo-demo", wabaId: "1234567890" };
const FACEBOOK = { id: "1234567890", name: "Ana Pérez", email: "ana@ejemplo.com" };

interface ConfigState {
  connectedBy: { adminEmail: string | null; facebookName: string | null; facebookEmail: string | null } | null;
}

// Alta por QR (coexistencia) en modo demo: cierra la conexión y deja registrado quién la hizo.
test.describe("conexión de WhatsApp por coexistencia", () => {
  test("el alta sigue funcionando y registra quién conectó (panel y Facebook)", async ({ browser }) => {
    const { context, page } = await loginAs(browser, "admin");
    try {
      const saved = await context.request.put("/api/whatsapp/config", { data: CREDENTIALS, headers: SAME_ORIGIN });
      expect(saved.ok()).toBe(true);

      const signup = await context.request.post("/api/whatsapp/embedded-signup", {
        data: { ...COEXISTENCE_SIGNUP, facebook: FACEBOOK },
        headers: SAME_ORIGIN,
      });
      expect(signup.status()).toBe(200);
      expect(((await signup.json()) as { warnings?: string[] }).warnings ?? []).not.toContain(
        "La conexión quedó lista, pero no se pudo registrar quién la hizo.",
      );

      const state = (await (await context.request.get("/api/whatsapp/config")).json()) as ConfigState;
      expect(state.connectedBy).toMatchObject({
        adminEmail: "admin@deli-gastro.com",
        facebookName: "Ana Pérez",
        facebookEmail: "ana@ejemplo.com",
      });

      await page.goto("/admin/whatsapp");
      await expect(page.getByTestId("connected-by")).toContainText("Ana Pérez");
      await expect(page.getByTestId("connected-by")).toContainText("admin@deli-gastro.com");
    } finally {
      await context.close();
    }
  });

  test("sin perfil de Facebook la conexión igual se cierra y no deja el perfil anterior", async ({ browser }) => {
    const { context } = await loginAs(browser, "admin");
    try {
      await context.request.put("/api/whatsapp/config", { data: CREDENTIALS, headers: SAME_ORIGIN });
      await context.request.post("/api/whatsapp/embedded-signup", {
        data: { ...COEXISTENCE_SIGNUP, facebook: FACEBOOK },
        headers: SAME_ORIGIN,
      });

      const again = await context.request.post("/api/whatsapp/embedded-signup", { data: COEXISTENCE_SIGNUP, headers: SAME_ORIGIN });
      expect(again.status()).toBe(200);

      const state = (await (await context.request.get("/api/whatsapp/config")).json()) as ConfigState;
      expect(state.connectedBy?.adminEmail).toBe("admin@deli-gastro.com");
      expect(state.connectedBy?.facebookName).toBeNull();
    } finally {
      await context.close();
    }
  });

  test("un perfil de Facebook inválido se descarta pero NO tumba la conexión", async ({ browser }) => {
    const { context } = await loginAs(browser, "admin");
    try {
      await context.request.put("/api/whatsapp/config", { data: CREDENTIALS, headers: SAME_ORIGIN });
      const res = await context.request.post("/api/whatsapp/embedded-signup", {
        data: { ...COEXISTENCE_SIGNUP, facebook: { id: "no-numerico", name: "Ana" } },
        headers: SAME_ORIGIN,
      });
      expect(res.status()).toBe(200);

      const state = (await (await context.request.get("/api/whatsapp/config")).json()) as ConfigState;
      expect(state.connectedBy?.adminEmail).toBe("admin@deli-gastro.com");
      expect(state.connectedBy?.facebookName).toBeNull();
    } finally {
      await context.close();
    }
  });
});
