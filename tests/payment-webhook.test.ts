import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, type DemoDb } from "./helpers/demo-db.ts";

const { handleMercadoPagoWebhook, MAX_WEBHOOK_BODY_BYTES } = await import("../src/lib/payments/webhook.ts");
const { startOnlinePayment } = await import("../src/lib/payments/intents.ts");
const mp = await import("../src/lib/payments/mercadopago.ts");
const { SAMPLE_ADDRESSES } = await import("../src/lib/restaurant.ts");

import type { PaymentGateway } from "../src/lib/payments/gateway.ts";
import type { MpPayment } from "../src/lib/payments/mercadopago.ts";

const SECRET = "whsec-test";
const NOW = 1_800_000_000;

function gatewayWith(payments: Record<string, MpPayment>): PaymentGateway & { fetched: string[] } {
  const fetched: string[] = [];
  return {
    name: "mercadopago",
    fetched,
    createCheckout: async (i) => ({ preferenceId: "p", url: `https://mp.test/${i.intentId}` }),
    fetchPayment: async (id) => {
      fetched.push(id);
      const p = payments[id];
      if (!p) throw new Error("404");
      return p;
    },
    findPayments: async () => [],
    refund: async () => undefined,
  };
}

async function openIntent(demo: DemoDb, gw: PaymentGateway) {
  const started = await startOnlinePayment(demo.db, gw, {
    clientId: String(demo.store.clients[0]!.id),
    items: [{ productId: String(demo.store.products.find((p) => p.name === "Hamburguesa Clásica")!.id), qty: 1 }],
    address: SAMPLE_ADDRESSES[0]!,
    paymentMethod: "Mercado Pago",
    channel: "web",
    actor: "cliente",
  });
  assert.ok(started.ok);
  return started.value;
}

function signedRequest(dataId: string, over: Partial<{ rawBody: string; ts: string; secret: string; requestId: string }> = {}) {
  const requestId = over.requestId ?? "req-1";
  const ts = over.ts ?? String(NOW);
  const v1 = mp.signManifest(over.secret ?? SECRET, mp.buildManifest({ dataId, requestId, ts }));
  return {
    rawBody: over.rawBody ?? JSON.stringify({ type: "payment", data: { id: dataId } }),
    signatureHeader: `ts=${ts},v1=${v1}`,
    requestId,
    queryDataId: dataId,
    queryType: "payment",
    secret: SECRET,
    nowSeconds: NOW,
  };
}

describe("handleMercadoPagoWebhook · defensas", () => {
  it("rechaza (401) una firma falsa sin consultar a Mercado Pago ni crear nada", async () => {
    const demo = createDemoDb();
    const gw = gatewayWith({});
    const before = demo.store.orders.length;
    const res = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("555", { secret: "otro-secreto" }));
    assert.equal(res.status, 401);
    assert.deepEqual(gw.fetched, []);
    assert.equal(demo.store.orders.length, before);
  });

  it("rechaza un aviso firmado pero viejo (replay)", async () => {
    const demo = createDemoDb();
    const res = await handleMercadoPagoWebhook(demo.db, gatewayWith({}), signedRequest("555", { ts: String(NOW - 600) }));
    assert.equal(res.status, 401);
    assert.equal(res.body?.reason, "stale");
  });

  it("rechaza el aviso sin cabeceras de firma", async () => {
    const demo = createDemoDb();
    const res = await handleMercadoPagoWebhook(demo.db, gatewayWith({}), { ...signedRequest("555"), signatureHeader: null });
    assert.equal(res.status, 401);
  });

  it("corta cuerpos enormes y cuerpos que no son JSON", async () => {
    const demo = createDemoDb();
    const big = await handleMercadoPagoWebhook(demo.db, gatewayWith({}), signedRequest("1", { rawBody: "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1) }));
    assert.equal(big.status, 413);
    const junk = await handleMercadoPagoWebhook(demo.db, gatewayWith({}), signedRequest("1", { rawBody: "no-json" }));
    assert.equal(junk.status, 400);
  });

  it("confirma y descarta los avisos que no son de pagos", async () => {
    const demo = createDemoDb();
    const gw = gatewayWith({});
    const res = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("9", { rawBody: JSON.stringify({ type: "merchant_order", data: { id: "9" } }) }));
    assert.equal(res.status, 200);
    assert.equal(res.body?.ignored, true);
    assert.deepEqual(gw.fetched, []);
  });
});

describe("handleMercadoPagoWebhook · pago aprobado", () => {
  it("vuelve a pedir el pago a Mercado Pago y crea el pedido; el estado del cuerpo no cuenta", async () => {
    const demo = createDemoDb();
    const base = gatewayWith({});
    const { intentId, total } = await openIntent(demo, base);
    const gw = gatewayWith({ "777": { id: 777, status: "approved", transaction_amount: total, currency_id: "ARS", external_reference: intentId } });
    const before = demo.store.orders.length;

    // El cuerpo miente (dice rechazado): igual manda lo que devuelve la API.
    const res = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("777", { rawBody: JSON.stringify({ type: "payment", status: "rejected", data: { id: "777" } }) }));
    assert.equal(res.status, 200);
    assert.deepEqual(gw.fetched, ["777"]);
    assert.equal(res.body?.result, "order_created");
    assert.ok(res.createdOrderId);
    assert.equal(demo.store.orders.length, before + 1);
  });

  it("un reintento del mismo aviso no duplica el pedido ni vuelve a avisar al cliente", async () => {
    const demo = createDemoDb();
    const { intentId, total } = await openIntent(demo, gatewayWith({}));
    const gw = gatewayWith({ "777": { id: 777, status: "approved", transaction_amount: total, currency_id: "ARS", external_reference: intentId } });

    const before = demo.store.orders.length;
    const first = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("777"));
    const second = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("777", { requestId: "req-2" }));
    assert.ok(first.createdOrderId);
    assert.equal(second.status, 200);
    assert.equal(second.createdOrderId, undefined);
    assert.equal(demo.store.orders.length, before + 1);
    assert.equal(demo.store.payment_intents.filter((i) => i.status === "approved").length, 1);
  });

  it("un pago por un monto distinto al cotizado no crea el pedido", async () => {
    const demo = createDemoDb();
    const { intentId } = await openIntent(demo, gatewayWith({}));
    const gw = gatewayWith({ "888": { id: 888, status: "approved", transaction_amount: 1, currency_id: "ARS", external_reference: intentId } });
    const before = demo.store.orders.length;
    const res = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("888"));
    assert.equal(res.status, 200);
    assert.equal(res.body?.result, "ignored");
    assert.equal(demo.store.orders.length, before);
  });

  it("ignora pagos cuya referencia no es una de nuestras intenciones", async () => {
    const demo = createDemoDb();
    const gw = gatewayWith({ "1": { id: 1, status: "approved", transaction_amount: 10, currency_id: "ARS", external_reference: "pedido-de-otra-tienda" } });
    const res = await handleMercadoPagoWebhook(demo.db, gw, signedRequest("1"));
    assert.equal(res.status, 200);
    assert.equal(res.body?.ignored, true);
  });

  it("si Mercado Pago no responde devuelve 500 para que reintente", async () => {
    const demo = createDemoDb();
    const res = await handleMercadoPagoWebhook(demo.db, gatewayWith({}), signedRequest("404"));
    assert.equal(res.status, 500);
  });
});
