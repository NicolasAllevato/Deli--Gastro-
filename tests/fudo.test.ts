import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

const { buildFudoOrder, parseFudoWebhook } = await import("../workers/fudo-gateway/src/payload.ts");
const { hmacHex, verifyHmacHex } = await import("../workers/fudo-gateway/src/signature.ts");
const { signGatewayBody, verifyGatewaySignature } = await import("../src/lib/fudo/gateway.ts");
const { applyFudoStatus, fudoTransition } = await import("../src/lib/fudo/status.ts");

const PIZZA = "00000001-0000-4000-8000-000000000000";
const FLAN = "00000002-0000-4000-8000-000000000000";

const maps = {
  products: new Map([[PIZZA, 11], [FLAN, 22]]),
  payments: new Map([["Efectivo", 1]]),
};

const order = (over: Partial<Parameters<typeof buildFudoOrder>[0]> = {}) => ({
  id: "abcd0000-0000-4000-8000-000000000000",
  total: 2 * 5000 + 1500 + 600,
  delivery_fee: 600,
  delivery_address: "Av. Corrientes 1234",
  payment_method: "Efectivo",
  notes: "Timbre B",
  client: { name: "Ana", phone: "1155550000" },
  items: [
    { product_id: PIZZA, name: "Pizza", qty: 2, unit_price: 5000 },
    { product_id: FLAN, name: "Flan", qty: 1, unit_price: 1500 },
  ],
  ...over,
});

describe("buildFudoOrder", () => {
  it("arma el pedido de delivery con productos, envío, cliente y medio de pago mapeados", () => {
    const result = buildFudoOrder(order(), maps);
    assert.ok(result.ok);
    assert.deepEqual(result.body.order, {
      externalId: "abcd0000-0000-4000-8000-000000000000",
      type: "delivery",
      typeOptions: { address: "Av. Corrientes 1234" },
      items: [
        { product: { id: 11 }, quantity: 2, price: 5000 },
        { product: { id: 22 }, quantity: 1, price: 1500 },
      ],
      payment: { total: 12100, paymentMethod: { id: 1 } },
      customer: { name: "Ana", phone: "1155550000" },
      shippingCost: 600,
      comment: "Timbre B",
    });
  });

  it("manda el canje de puntos como descuento por la diferencia con el total", () => {
    const result = buildFudoOrder(order({ total: 12100 - 1150 }), maps);
    assert.ok(result.ok);
    assert.deepEqual(result.body.order.discounts, [{ amount: 1150 }]);
  });

  it("sin mapeo del medio de pago lo anota en el comentario", () => {
    const result = buildFudoOrder(order({ payment_method: "Mercado Pago", notes: null }), maps);
    assert.ok(result.ok);
    assert.deepEqual(result.body.order.payment, { total: 12100 });
    assert.equal(result.body.order.comment, "Pago: Mercado Pago");
  });

  it("no manda pedidos con productos sin mapear ni sin líneas", () => {
    const sinMapa = buildFudoOrder(order({ items: [{ product_id: "otro", name: "Empanada", qty: 1, unit_price: 100 }] }), maps);
    assert.deepEqual(sinMapa, { ok: false, reason: "Productos sin mapear a Fudo: Empanada" });
    assert.equal(buildFudoOrder(order({ items: [] }), maps).ok, false);
  });

  it("recorta los textos a los máximos de Fudo", () => {
    const result = buildFudoOrder(order({ notes: "x".repeat(400), client: { name: "y".repeat(120), phone: null } }), maps);
    assert.ok(result.ok);
    assert.equal(result.body.order.comment!.length, 254);
    assert.deepEqual(Object.keys(result.body.order.customer!), ["name"]);
    assert.equal(result.body.order.customer!.name.length, 90);
  });
});

describe("parseFudoWebhook", () => {
  it("encuentra evento, id de Fudo y externalId en las formas probables", () => {
    assert.deepEqual(parseFudoWebhook({ event: "ORDER-CONFIRMED", order: { id: 99, externalId: "e1" } }, null), {
      event: "ORDER-CONFIRMED", fudoOrderId: 99, externalId: "e1",
    });
    assert.deepEqual(parseFudoWebhook({ type: "order_closed", data: { id: "7" } }, null), {
      event: "ORDER-CLOSED", fudoOrderId: 7, externalId: null,
    });
    assert.deepEqual(parseFudoWebhook({ orderId: 5 }, "ORDER-REJECTED"), {
      event: "ORDER-REJECTED", fudoOrderId: 5, externalId: null,
    });
  });

  it("no revienta con cuerpos raros", () => {
    assert.deepEqual(parseFudoWebhook(null, null), { event: null, fudoOrderId: null, externalId: null });
    assert.deepEqual(parseFudoWebhook([1, 2], null), { event: null, fudoOrderId: null, externalId: null });
  });
});

describe("firmas", () => {
  it("la app y el Worker firman igual (x-gateway-signature)", async () => {
    const body = JSON.stringify({ orderId: "x" });
    const workerSig = await hmacHex(body, "secreto");
    assert.equal(workerSig, signGatewayBody(body, "secreto"));
    assert.ok(verifyGatewaySignature(body, workerSig, "secreto"));
    assert.ok(await verifyHmacHex(body, signGatewayBody(body, "secreto"), "secreto"));
  });

  it("rechaza firmas ausentes, mal formadas o de otro secreto", async () => {
    const body = "{}";
    assert.equal(verifyGatewaySignature(body, null, "s"), false);
    assert.equal(verifyGatewaySignature(body, "zz", "s"), false);
    assert.equal(verifyGatewaySignature(body, signGatewayBody(body, "otro"), "s"), false);
    assert.equal(await verifyHmacHex(body, await hmacHex(body, "otro"), "s"), false);
    assert.equal(await verifyHmacHex(body, await hmacHex(body, "s"), ""), false);
  });
});

describe("fudoTransition", () => {
  it("solo avanza y nunca sale de un estado final", () => {
    assert.ok(fudoTransition("Recibidos", "Finalizados"));
    assert.ok(fudoTransition("En Camino", "Cancelado"));
    assert.equal(fudoTransition("En Camino", "En Preparación"), false);
    assert.equal(fudoTransition("En Camino", "En Camino"), false);
    assert.equal(fudoTransition("Finalizados", "Cancelado"), false);
    assert.equal(fudoTransition("Cancelado", "En Preparación"), false);
  });
});

describe("applyFudoStatus", () => {
  function pedidoRecibido(demo: ReturnType<typeof createDemoDb>) {
    const row = demo.store.orders.find((o) => o.status === "Recibidos")!;
    row.fudo_order_id = 4242;
    return row;
  }

  it("confirmado en Fudo pasa a En Preparación con marca de tiempo y bitácora", async () => {
    const demo = createDemoDb();
    const row = pedidoRecibido(demo);
    const result = await applyFudoStatus(demo.db, { event: "ORDER-CONFIRMED", fudoOrderId: 4242 });
    assert.deepEqual(result, { applied: true, status: "En Preparación" });
    assert.equal(row.status, "En Preparación");
    assert.ok(row.accepted_at);
    assert.ok(demo.store.order_events.some((e) => e.order_id === row.id && e.actor === "fudo" && e.event === "En Preparación"));
  });

  it("cerrado sin pasos previos completa las marcas y lo finaliza; repetido se ignora", async () => {
    const demo = createDemoDb();
    const row = pedidoRecibido(demo);
    assert.deepEqual(await applyFudoStatus(demo.db, { event: "ORDER-CLOSED", orderId: String(row.id) }), {
      applied: true, status: "Finalizados",
    });
    assert.ok(row.accepted_at && row.ready_at && row.delivered_at);
    assert.deepEqual(await applyFudoStatus(demo.db, { event: "ORDER-CLOSED", fudoOrderId: 4242 }), {
      applied: false, reason: "ignored",
    });
  });

  it("rechazado en Fudo cancela el pedido", async () => {
    const demo = createDemoDb();
    const row = pedidoRecibido(demo);
    assert.deepEqual(await applyFudoStatus(demo.db, { event: "ORDER-REJECTED", fudoOrderId: 4242 }), {
      applied: true, status: "Cancelado",
    });
    assert.equal(row.status, "Cancelado");
  });

  it("pedido desconocido → not_found", async () => {
    const demo = createDemoDb();
    assert.deepEqual(await applyFudoStatus(demo.db, { event: "ORDER-CONFIRMED", fudoOrderId: 1 }), {
      applied: false, reason: "not_found",
    });
  });
});
