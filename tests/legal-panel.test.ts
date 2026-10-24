import { test } from "node:test";
import assert from "node:assert/strict";
import { panelConfigFromEnv, sendAcceptanceToPanel, type PanelAcceptance } from "../src/lib/legal/panel.ts";

const acceptance: PanelAcceptance = {
  userId: "u-1",
  email: "admin.prueba@deligastro.test",
  role: "admin",
  document: "terminos",
  version: "2026-10-14",
  acceptedAt: "2026-10-24T13:00:00.000Z",
  ip: "127.0.0.1",
  userAgent: "Mozilla/5.0",
};
const cfg = { url: "https://panel.x", clienteId: "c-9", token: "tok" };

test("config: necesita URL, cliente y token; recorta la barra final", () => {
  assert.equal(panelConfigFromEnv({ PANEL_CONTROL_URL: "https://panel.x" }), null);
  assert.deepEqual(
    panelConfigFromEnv({ PANEL_CONTROL_URL: "https://panel.x/", PANEL_CONTROL_CLIENTE_ID: "c-9", PANEL_CONTROL_TOKEN: " tok " }),
    cfg,
  );
});

test("envía al webhook del cliente con Bearer y el payload que espera el Panel", async () => {
  let call: { url: string; init: RequestInit } | null = null;
  const fake = (async (url: string, init: RequestInit) => {
    call = { url, init };
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;

  assert.equal(await sendAcceptanceToPanel(acceptance, cfg, fake), true);
  assert.equal(call!.url, "https://panel.x/api/webhooks/agentes-ia/c-9/aceptaciones");
  assert.equal((call!.init.headers as Record<string, string>).Authorization, "Bearer tok");
  assert.deepEqual(JSON.parse(call!.init.body as string), {
    app: "deli-gastro", usuario_id: "u-1", email: "admin.prueba@deligastro.test", rol: "admin",
    documento: "terminos", version: "2026-10-14", aceptado_at: "2026-10-24T13:00:00.000Z",
    ip: "127.0.0.1", user_agent: "Mozilla/5.0",
  });
});

test("sin configuración no envía nada", async () => {
  let called = false;
  const fake = (async () => { called = true; return new Response("{}"); }) as unknown as typeof fetch;
  assert.equal(await sendAcceptanceToPanel(acceptance, null, fake), false);
  assert.equal(called, false);
});

test("un Panel caído o que rechaza no lanza: devuelve false", async () => {
  const original = console.error;
  console.error = () => {};
  try {
    const down = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    const rejects = (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch;
    assert.equal(await sendAcceptanceToPanel(acceptance, cfg, down), false);
    assert.equal(await sendAcceptanceToPanel(acceptance, cfg, rejects), false);
  } finally {
    console.error = original;
  }
});
