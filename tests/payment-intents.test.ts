import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, type DemoDb } from "./helpers/demo-db.ts";

const { startOnlinePayment, settlePayment, expireDueIntents, reconcileIntent, cancelPendingIntent, getIntentForClient, latestPendingIntent } =
  await import("../src/lib/payments/intents.ts");
const { refundPaymentForOrder } = await import("../src/lib/payments/refunds.ts");
const { cancelOrderForClient } = await import("../src/lib/orders-create.ts");
const { listOrders } = await import("../src/lib/orders-server.ts");
const { SAMPLE_ADDRESSES } = await import("../src/lib/restaurant.ts");

import type { PaymentGateway } from "../src/lib/payments/gateway.ts";
import type { MpPayment } from "../src/lib/payments/mercadopago.ts";

const CASA = SAMPLE_ADDRESSES[0]!;

interface FakeGateway extends PaymentGateway {
  refunds: Array<{ paymentId: string; key: string }>;
  failRefund: boolean;
  failCheckout: boolean;
  remote: MpPayment[];
}

function fakeGateway(): FakeGateway {
  const gw: FakeGateway = {
    name: "mercadopago",
    refunds: [],
    failRefund: false,
    failCheckout: false,
    remote: [],
    async createCheckout(input) {
      if (gw.failCheckout) throw new Error("MP caído");
      return { preferenceId: `pref-${input.intentId}`, url: `https://mp.test/checkout/${input.intentId}` };
    },
    async fetchPayment(id) {
      const found = gw.remote.find((p) => String(p.id) === id);
      if (!found) throw new Error("no existe");
      return found;
    },
    async findPayments() {
      return gw.remote;
    },
    async refund(paymentId, key) {
      if (gw.failRefund) throw new Error("MP rechazó el reembolso");
      gw.refunds.push({ paymentId, key });
    },
  };
  return gw;
}

const productId = (demo: DemoDb, name: string) => String(demo.store.products.find((p) => p.name === name)!.id);
const clientId = (demo: DemoDb) => String(demo.store.clients[0]!.id); // Sofía: 180 puntos
const saldo = (demo: DemoDb) => Number(demo.store.clients[0]!.total_points);

function input(demo: DemoDb, extra: Record<string, unknown> = {}) {
  return {
    clientId: clientId(demo),
    items: [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }],
    address: CASA,
    paymentMethod: "Mercado Pago" as const,
    channel: "web" as const,
    actor: "cliente",
    ...extra,
  };
}

async function start(demo: DemoDb, gw: FakeGateway, extra: Record<string, unknown> = {}) {
  const started = await startOnlinePayment(demo.db, gw, input(demo, extra));
  assert.ok(started.ok, started.ok ? "" : started.message);
  return started.value;
}

const approved = (intentId: string, total: number, extra: Partial<MpPayment> = {}): MpPayment => ({
  id: 5550001,
  status: "approved",
  transaction_amount: total,
  currency_id: "ARS",
  external_reference: intentId,
  ...extra,
});

describe("startOnlinePayment", () => {
  it("guarda la intención con el pedido cotizado y NO crea el pedido", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const before = demo.store.orders.length;
    const started = await start(demo, gw);

    assert.equal(started.total, 9100); // 8500 + envío 600
    assert.match(started.url, /^https:\/\/mp\.test\/checkout\//);
    assert.equal(demo.store.orders.length, before);

    const intent = demo.store.payment_intents[0]!;
    assert.equal(intent.status, "pending");
    assert.equal(intent.mp_preference_id, `pref-${started.intentId}`);
    assert.equal(saldo(demo), 180);
  });

  it("si Mercado Pago falla, cancela la intención y no deja nada pendiente", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    gw.failCheckout = true;
    const result = await startOnlinePayment(demo.db, gw, input(demo));
    assert.ok(!result.ok);
    assert.equal(result.status, 502);
    assert.equal(demo.store.payment_intents[0]!.status, "cancelled");
  });

  it("no abre el cobro si la cotización falla (producto inexistente)", async () => {
    const demo = createDemoDb();
    const result = await startOnlinePayment(demo.db, fakeGateway(), input(demo, { items: [{ productId: crypto.randomUUID(), qty: 1 }] }));
    assert.ok(!result.ok);
    assert.equal(demo.store.payment_intents.length, 0);
  });
});

describe("settlePayment · pago aprobado", () => {
  it("crea el pedido una sola vez, con medio de pago, evento y total cotizado", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const before = demo.store.orders.length;

    const result = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(result.ok && result.value.kind === "order_created");
    const order = result.value.order;
    assert.equal(order.payment_method, "Mercado Pago");
    assert.equal(Number(order.total), 9100);
    assert.equal(order.status, "Recibidos");
    assert.equal(demo.store.orders.length, before + 1);
    assert.ok(demo.store.order_events.some((e) => e.order_id === order.id && e.event === "pago_aprobado"));

    const intent = demo.store.payment_intents[0]!;
    assert.deepEqual([intent.status, intent.order_id, intent.mp_payment_id], ["approved", order.id, "5550001"]);
  });

  it("el mismo aviso repetido o en paralelo no duplica el pedido", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const before = demo.store.orders.length;

    const results = await Promise.all([
      settlePayment(demo.db, gw, intentId, approved(intentId, total)),
      settlePayment(demo.db, gw, intentId, approved(intentId, total)),
      settlePayment(demo.db, gw, intentId, approved(intentId, total)),
    ]);
    const kinds = results.map((r) => (r.ok ? r.value.kind : "error")).sort();
    assert.deepEqual(kinds, ["already_settled", "already_settled", "order_created"]);
    assert.equal(demo.store.orders.length, before + 1);
  });

  it("el pedido recién pagado aparece en el tablero y antes no existía", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const ids = async () => (await listOrders(demo.db, { limit: 500 })).map((o) => o.id);

    const antes = await ids();
    const result = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(result.ok && result.value.kind === "order_created");
    const despues = await ids();
    assert.equal(despues.length, antes.length + 1);
    assert.ok(despues.includes(result.value.order.id));
  });

  it("cobra los puntos del canje recién al aprobarse el pago, ligados al pedido", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw, { rewardId: "descuento" });
    assert.equal(total, 8500 - 850 + 600);
    assert.equal(saldo(demo), 180);

    const result = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(result.ok && result.value.kind === "order_created");
    assert.equal(saldo(demo), 80);
    const mov = demo.store.points_ledger.at(-1)!;
    assert.deepEqual([mov.order_id, mov.delta], [result.value.order.id, -100]);
  });

  it("los puntos de un canje con pago pendiente quedan reservados: no pagan otro canje", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    await start(demo, gw, { rewardId: "descuento" }); // reserva 100 de 180

    const otroOnline = await startOnlinePayment(demo.db, gw, input(demo, { rewardId: "descuento" }));
    assert.ok(!otroOnline.ok);
    assert.equal(otroOnline.status, 409);

    const { createDeliveryOrder } = await import("../src/lib/orders-create.ts");
    const enEfectivo = await createDeliveryOrder(demo.db, { ...input(demo, { rewardId: "descuento" }), paymentMethod: "Efectivo" });
    assert.ok(!enEfectivo.ok);
    assert.equal(saldo(demo), 180);

    // Si el pago pendiente se cancela, la reserva se libera.
    demo.store.payment_intents[0]!.status = "cancelled";
    const ahora = await createDeliveryOrder(demo.db, { ...input(demo, { rewardId: "descuento" }), paymentMethod: "Efectivo" });
    assert.ok(ahora.ok);
    assert.equal(saldo(demo), 80);
  });

  it("ignora un pago de otro monto, otra moneda o de una intención desconocida", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const before = demo.store.orders.length;

    for (const bad of [approved(intentId, 100), approved(intentId, total, { currency_id: "USD" }), approved("otra", total)]) {
      const r = await settlePayment(demo.db, gw, intentId, bad);
      assert.ok(r.ok && r.value.kind === "ignored");
    }
    const unknown = await settlePayment(demo.db, gw, crypto.randomUUID(), approved(intentId, total));
    assert.ok(unknown.ok && unknown.value.kind === "ignored");
    assert.equal(demo.store.orders.length, before);
    assert.equal(demo.store.payment_intents[0]!.status, "pending");
  });

  it("un pago pendiente o rechazado no crea el pedido", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const before = demo.store.orders.length;
    for (const status of ["pending", "in_process", "rejected"]) {
      const r = await settlePayment(demo.db, gw, intentId, approved(intentId, total, { status }));
      assert.ok(r.ok && r.value.kind === "no_change");
    }
    assert.equal(demo.store.orders.length, before);
    assert.equal(demo.store.payment_intents[0]!.status, "pending");
  });
});

describe("settlePayment · pagos fuera de término", () => {
  it("si pagan una intención ya cancelada o vencida, se les devuelve el pago y no hay pedido", async () => {
    for (const status of ["cancelled", "expired"]) {
      const demo = createDemoDb();
      const gw = fakeGateway();
      const { intentId, total } = await start(demo, gw);
      demo.store.payment_intents[0]!.status = status;
      const before = demo.store.orders.length;

      const r = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
      assert.ok(r.ok && r.value.kind === "refunded_late");
      assert.equal(gw.refunds.length, 1);
      assert.equal(demo.store.orders.length, before);
      assert.equal(demo.store.payment_intents[0]!.status, "refunded");
    }
  });

  it("si ese reembolso falla, responde error (Mercado Pago reintenta) y deja el motivo anotado", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    gw.failRefund = true;
    const { intentId, total } = await start(demo, gw);
    demo.store.payment_intents[0]!.status = "expired";

    const r = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(!r.ok);
    assert.match(String(demo.store.payment_intents[0]!.refund_error), /rechazó/);
  });
});

describe("settlePayment · pago devuelto", () => {
  it("un reembolso o contracargo cancela el pedido en marcha y devuelve los puntos del canje", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw, { rewardId: "descuento" });
    const created = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(created.ok && created.value.kind === "order_created");
    assert.equal(saldo(demo), 80);

    const reversed = await settlePayment(demo.db, gw, intentId, approved(intentId, total, { status: "charged_back" }));
    assert.ok(reversed.ok && reversed.value.kind === "order_cancelled");
    const orderId = created.value.order.id;
    assert.equal(demo.store.orders.find((o) => o.id === orderId)!.status, "Cancelado");
    assert.equal(demo.store.payment_intents[0]!.status, "refunded");
    assert.equal(saldo(demo), 180);
    assert.equal(gw.refunds.length, 0); // Mercado Pago ya devolvió: no se reembolsa de nuevo
  });
});

describe("cancelar un pedido pagado", () => {
  it("reembolsa el pago completo, una sola vez", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const created = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(created.ok && created.value.kind === "order_created");

    const first = await refundPaymentForOrder(demo.db, gw, created.value.order.id);
    assert.equal(first.refunded, true);
    assert.deepEqual(gw.refunds, [{ paymentId: "5550001", key: `refund-${intentId}` }]);
    assert.equal(demo.store.payment_intents[0]!.status, "refunded");

    const again = await refundPaymentForOrder(demo.db, gw, created.value.order.id);
    assert.equal(again.refunded, false);
    assert.equal(gw.refunds.length, 1);
  });

  it("un pedido que no se pagó online no dispara ningún reembolso", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const r = await refundPaymentForOrder(demo.db, gw, String(demo.store.orders[0]!.id));
    assert.deepEqual(r, { refunded: false });
    assert.equal(gw.refunds.length, 0);
  });

  it("si el reembolso falla, queda anotado para resolverlo a mano", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    gw.failRefund = true;
    const { intentId, total } = await start(demo, gw);
    const created = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(created.ok && created.value.kind === "order_created");

    const r = await refundPaymentForOrder(demo.db, gw, created.value.order.id);
    assert.equal(r.refunded, false);
    assert.match(String(r.error), /rechazó/);
    assert.equal(demo.store.payment_intents[0]!.status, "approved");
    assert.match(String(demo.store.payment_intents[0]!.refund_error), /rechazó/);
  });

  it("cancelar desde el cliente sin cobro digital configurado deja el reembolso pendiente en la bitácora", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);
    const created = await settlePayment(demo.db, gw, intentId, approved(intentId, total));
    assert.ok(created.ok && created.value.kind === "order_created");

    const orderId = created.value.order.id;
    const cancelled = await cancelOrderForClient(demo.db, orderId, clientId(demo), "cliente");
    assert.ok(cancelled.ok); // en los tests no hay MP_ACCESS_TOKEN: no hay gateway
    assert.ok(demo.store.order_events.some((e) => e.order_id === orderId && e.event === "reembolso_pendiente"));
  });
});

describe("vencimiento, conciliación y cancelación de la intención", () => {
  it("vence solo las intenciones pendientes pasadas de hora", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    await start(demo, gw);
    assert.equal(await expireDueIntents(demo.db, new Date()), 0);
    assert.equal(await expireDueIntents(demo.db, new Date(Date.now() + 31 * 60_000)), 1);
    assert.equal(demo.store.payment_intents[0]!.status, "expired");
    assert.equal(await expireDueIntents(demo.db, new Date(Date.now() + 99 * 60_000)), 0);
  });

  it("reconcileIntent crea el pedido si Mercado Pago ya tiene el pago aprobado", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId, total } = await start(demo, gw);

    assert.equal(await reconcileIntent(demo.db, gw, intentId), null); // todavía no pagó
    gw.remote = [approved(intentId, total, { status: "rejected", id: 1 }), approved(intentId, total, { id: 2 })];
    const r = await reconcileIntent(demo.db, gw, intentId);
    assert.equal(r?.kind, "order_created");
    assert.equal(await reconcileIntent(demo.db, gw, intentId), null); // ya no está pendiente
  });

  it("solo el dueño cancela una intención pendiente", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId } = await start(demo, gw);
    const otro = String(demo.store.clients[1]!.id);

    assert.equal(await cancelPendingIntent(demo.db, intentId, otro), false);
    assert.equal(await cancelPendingIntent(demo.db, intentId, clientId(demo)), true);
    assert.equal(await cancelPendingIntent(demo.db, intentId, clientId(demo)), false);
    assert.equal(demo.store.payment_intents[0]!.status, "cancelled");
  });

  it("el estado de una intención solo lo ve su dueño y marca vencida la que pasó de hora", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId } = await start(demo, gw);
    const otro = String(demo.store.clients[1]!.id);

    assert.equal(await getIntentForClient(demo.db, intentId, otro), null);
    assert.equal((await getIntentForClient(demo.db, intentId, clientId(demo)))?.status, "pending");
    demo.store.payment_intents[0]!.expires_at = new Date(Date.now() - 1000).toISOString();
    assert.equal((await getIntentForClient(demo.db, intentId, clientId(demo)))?.status, "expired");
  });

  it("latestPendingIntent devuelve la vigente más reciente y nada si venció", async () => {
    const demo = createDemoDb();
    const gw = fakeGateway();
    const { intentId } = await start(demo, gw);
    assert.equal((await latestPendingIntent(demo.db, clientId(demo)))?.id, intentId);
    assert.equal(await latestPendingIntent(demo.db, clientId(demo), new Date(Date.now() + 31 * 60_000)), null);
  });
});
