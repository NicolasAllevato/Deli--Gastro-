import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";

const api = await import("../src/lib/payments/mp-api.ts");
const { mercadoPagoGateway, demoGateway } = await import("../src/lib/payments/gateway.ts");

const cfg = { accessToken: "TEST-secret-token", webhookSecret: "whsec", baseUrl: "https://dely.example.com" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function fakeFetch(responder: (call: Call) => { status?: number; json?: unknown }) {
  const calls: Call[] = [];
  const impl = async (url: string, init: RequestInit = {}) => {
    const call: Call = {
      url,
      method: init.method ?? "GET",
      headers: init.headers as Record<string, string>,
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const out = responder(call);
    return new Response(JSON.stringify(out.json ?? {}), { status: out.status ?? 200 });
  };
  return { calls, impl };
}

describe("readMpConfig", () => {
  it("exige las tres variables", () => {
    assert.equal(api.readMpConfig({}), null);
    assert.equal(api.readMpConfig({ MP_ACCESS_TOKEN: "a", MP_WEBHOOK_SECRET: "b" }), null);
    assert.deepEqual(api.readMpConfig({ MP_ACCESS_TOKEN: " a ", MP_WEBHOOK_SECRET: "b", PUBLIC_URL: "https://x.com" }), {
      accessToken: "a",
      webhookSecret: "b",
      baseUrl: "https://x.com",
    });
  });
});

describe("mercadoPagoGateway", () => {
  it("crea la preferencia con idempotencia, notification_url y devuelve el checkout de sandbox con credenciales de prueba", async () => {
    const { calls, impl } = fakeFetch(() => ({ json: { id: "pref-1", init_point: "https://mp/prod", sandbox_init_point: "https://mp/sandbox" } }));
    const gw = mercadoPagoGateway(cfg, impl);
    const out = await gw.createCheckout({ intentId: "int-1", title: "Pedido $9.100", total: 9100, expiresAt: new Date("2026-10-15T20:00:00Z") });

    assert.deepEqual(out, { preferenceId: "pref-1", url: "https://mp/sandbox" });
    const call = calls[0]!;
    assert.equal(call.url, "https://api.mercadopago.com/checkout/preferences");
    assert.equal(call.method, "POST");
    assert.equal(call.headers.Authorization, "Bearer TEST-secret-token");
    assert.equal(call.headers["X-Idempotency-Key"], "pref-int-1");
    const body = call.body as { notification_url: string; external_reference: string; items: Array<{ unit_price: number }> };
    assert.equal(body.notification_url, "https://dely.example.com/api/payments/mercadopago/webhook");
    assert.equal(body.external_reference, "int-1");
    assert.equal(body.items[0]!.unit_price, 9100);
  });

  it("con credenciales reales usa el checkout de producción", async () => {
    const { impl } = fakeFetch(() => ({ json: { id: "p", init_point: "https://mp/prod", sandbox_init_point: "https://mp/sandbox" } }));
    const gw = mercadoPagoGateway({ ...cfg, accessToken: "APP_USR-real" }, impl);
    const out = await gw.createCheckout({ intentId: "i", title: "t", total: 1, expiresAt: new Date() });
    assert.equal(out.url, "https://mp/prod");
  });

  it("consulta, busca por referencia y reembolsa con la clave de idempotencia", async () => {
    const { calls, impl } = fakeFetch((c) => (c.url.includes("/search") ? { json: { results: [{ id: 1, status: "approved" }] } } : { json: { id: 7 } }));
    const gw = mercadoPagoGateway(cfg, impl);

    await gw.fetchPayment("555 1");
    assert.equal(calls[0]!.url, "https://api.mercadopago.com/v1/payments/555%201");

    const found = await gw.findPayments("int 1");
    assert.equal(found.length, 1);
    assert.match(calls[1]!.url, /external_reference=int%201/);

    await gw.refund("555", "refund-int-1");
    assert.equal(calls[2]!.url, "https://api.mercadopago.com/v1/payments/555/refunds");
    assert.equal(calls[2]!.method, "POST");
    assert.equal(calls[2]!.headers["X-Idempotency-Key"], "refund-int-1");
  });

  it("ante un error HTTP lanza MpApiError sin incluir el token ni el cuerpo de la respuesta", async () => {
    const { impl } = fakeFetch(() => ({ status: 401, json: { message: "datos del pagador", token: "TEST-secret-token" } }));
    const gw = mercadoPagoGateway(cfg, impl);
    await assert.rejects(gw.fetchPayment("1"), (e: Error) => {
      assert.equal(e.name, "MpApiError");
      assert.equal((e as { status?: number }).status, 401);
      assert.doesNotMatch(e.message, /TEST-secret-token|pagador/);
      return true;
    });
  });

  it("una búsqueda sin resultados devuelve lista vacía", async () => {
    const { impl } = fakeFetch(() => ({ json: {} }));
    assert.deepEqual(await mercadoPagoGateway(cfg, impl).findPayments("x"), []);
  });
});

describe("demoGateway", () => {
  it("apunta al simulador local y no sale a la red", async () => {
    const out = await demoGateway().createCheckout({ intentId: "abc", title: "t", total: 1, expiresAt: new Date() });
    assert.equal(out.url, "/demo/mercadopago/abc");
    await assert.doesNotReject(demoGateway().refund("1", "k"));
  });
});
