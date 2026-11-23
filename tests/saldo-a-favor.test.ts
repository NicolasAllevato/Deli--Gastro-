/** Saldo a favor: ledger, resolución de reclamos, cobro (parcial y total), reserva, cancelación, bot y Fudo. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, type DemoDb } from "./helpers/demo-db.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";

const { addCredit, addCreditStatement, getCredit, InsufficientCreditError } = await import("../src/lib/data/credit.ts");
const { resolverReclamo } = await import("../src/lib/data/reclamos.ts");
const { startOnlinePayment, settlePayment } = await import("../src/lib/payments/intents.ts");
const { createDeliveryOrder, cancelOrderForClient, cancelOrderBySystem, prepareDeliveryOrder, placeOrder } = await import("../src/lib/orders-create.ts");
const { refundCreditForOrder } = await import("../src/lib/credit-server.ts");
const { SAMPLE_ADDRESSES } = await import("../src/lib/restaurant.ts");
const { renderQuoteSummary } = await import("../workers/whatsapp-bot/src/orders/flow.ts");
const { buildFudoOrder } = await import("../workers/fudo-gateway/src/payload.ts");
const { mensajeResolucion } = await import("../src/lib/reclamos/mensajes.ts");
const { accionReclamo } = await import("../src/lib/reclamos/api.ts");

import type { PaymentGateway } from "../src/lib/payments/gateway.ts";

const CASA = SAMPLE_ADDRESSES[0]!; // envío $600
const admin = { kind: "admin", userId: "u1" } as const;

/* ------------------------------------------------------------ capa de datos (SQL real) */

describe("credit_ledger (capa de datos)", () => {
  function world() {
    const db = createTestDb();
    db.raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Ana')");
    return db;
  }
  const entry = (key: string, deltaCents: number) => ({ id: crypto.randomUUID(), clientId: "c1", deltaCents, motivo: "reclamo" as const, idempotencyKey: key });

  it("acredita una sola vez por clave y el saldo nunca queda negativo", async () => {
    const db = world();
    assert.equal(await addCredit(db, admin, entry("k1", 500_000)), true);
    assert.equal(await addCredit(db, admin, entry("k1", 500_000)), false);
    assert.equal(await getCredit(db, admin, "c1"), 500_000);
    await assert.rejects(() => addCredit(db, admin, { ...entry("k2", -500_001), motivo: "compra" }), InsufficientCreditError);
    assert.equal(await addCredit(db, admin, { ...entry("k3", -500_000), motivo: "compra" }), true);
    assert.equal(await getCredit(db, admin, "c1"), 0);
  });

  it("solo el personal asienta, y exige clave", async () => {
    const db = world();
    assert.throws(() => addCreditStatement(db, { kind: "cliente", userId: "x" }, entry("k", 100)), /No autorizado/);
    assert.throws(() => addCreditStatement(db, admin, entry(" ", 100)), /idempotencyKey/);
  });
});

/* ------------------------------------------------------------ reclamos */

function reclamoWorld(withOrder: boolean) {
  const db = createTestDb();
  db.raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Ana')");
  if (withOrder) db.raw.exec("INSERT INTO orders (id, client_id, items_desc, total_cents) VALUES ('o1', 'c1', '1x Muzza', 1250000)");
  db.raw
    .prepare("INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, order_id, motivo) VALUES ('r1', 1, 'cv1', '5491100000000', 'c1', ?, 'llegó frío')")
    .run(withOrder ? "o1" : null);
  return db;
}
const credit = (db: ReturnType<typeof createTestDb>) => (db.raw.prepare("SELECT credit_cents AS c FROM clients WHERE id = 'c1'").get() as { c: number }).c;

describe("resolverReclamo con saldo a favor", () => {
  it("acredita pesos en el mismo batch, con asiento ligado al reclamo", async () => {
    const db = reclamoWorld(true);
    const r = await resolverReclamo(db, admin, "r1", { resolucion: "Perdón", compensacion: { tipo: "saldo", valor: 2000 } });
    assert.equal(r.saldoAcreditado, 2000);
    assert.equal(credit(db), 200_000);
    const row = db.raw.prepare("SELECT motivo, idempotency_key, reclamo_id FROM credit_ledger").get() as Record<string, string>;
    assert.deepEqual({ ...row }, { motivo: "reclamo", idempotency_key: "reclamo:r1:saldo", reclamo_id: "r1" });
    await assert.rejects(() => resolverReclamo(db, admin, "r1", { resolucion: "otra" }), /ya está resuelto/);
    assert.equal(credit(db), 200_000);
  });

  it("el descuento % se convierte en pesos sobre el total del pedido asociado", async () => {
    const db = reclamoWorld(true);
    const r = await resolverReclamo(db, admin, "r1", { resolucion: "Perdón", compensacion: { tipo: "descuento", valor: 10 } });
    assert.equal(r.saldoAcreditado, 1250);
    assert.equal(credit(db), 125_000);
    assert.deepEqual({ ...(db.raw.prepare("SELECT compensacion_tipo AS t, compensacion_valor AS v FROM reclamos").get() as object) }, { t: "saldo", v: 1250 });
  });

  it("el descuento % sin pedido asociado se rechaza y no resuelve nada", async () => {
    const db = reclamoWorld(false);
    await assert.rejects(() => resolverReclamo(db, admin, "r1", { resolucion: "Perdón", compensacion: { tipo: "descuento", valor: 10 } }), /pedido asociado/);
    assert.equal((db.raw.prepare("SELECT estado FROM reclamos").get() as { estado: string }).estado, "abierto");
    assert.equal(credit(db), 0);
  });

  it("la API arma el aviso con el saldo ya convertido", async () => {
    assert.match(mensajeResolucion(3, "Listo", { tipo: "saldo", valor: 1250 }), /Te acreditamos \$1250 de saldo a favor para tu próxima compra/);
    let recibido: unknown = null;
    const reclamo = { numero: 3, pedido: { total_cents: 1250000 }, client_id: "c1", motivo: "x", categoria: "demora", estado: "abierto", resolucion: null, foto_keys: [] };
    const deps = {
      get: async () => reclamo,
      resolver: async (_a: unknown, _id: string, input: { compensacion: unknown; mensaje: string }) => {
        recibido = input;
        return { reclamo, puntosAcreditados: 0, saldoAcreditado: 1250 };
      },
      marcarNotificacion: async () => {},
      enviar: async () => ({ ok: true }),
    };
    const res = await accionReclamo(admin, "11111111-1111-4111-8111-111111111111", { accion: "resolver", resolucion: "Listo", compensacion: { tipo: "descuento", valor: 10 } }, deps as never);
    assert.equal(res.status, 200);
    assert.deepEqual((recibido as { compensacion: unknown }).compensacion, { tipo: "saldo", valor: 1250 });
    assert.match((recibido as { mensaje: string }).mensaje, /\$1250 de saldo a favor/);
    assert.equal(res.body.saldoAcreditado, 1250);
  });
});

/* ------------------------------------------------------------ cobro, reserva y cancelación */

const productId = (demo: DemoDb, name: string) => String(demo.store.products.find((p) => p.name === name)!.id);
const client = (demo: DemoDb) => demo.store.clients[0]!;
const give = (demo: DemoDb, pesos: number) => { client(demo).credit = pesos; };

function input(demo: DemoDb, extra: Record<string, unknown> = {}) {
  return {
    clientId: String(client(demo).id),
    items: [{ productId: productId(demo, "Hamburguesa Clásica"), qty: 1 }], // $8.500 + $600 de envío
    address: CASA,
    paymentMethod: "Efectivo" as const,
    channel: "web" as const,
    actor: "cliente",
    ...extra,
  };
}

function fakeGateway() {
  const gw = {
    name: "mercadopago" as const,
    checkouts: 0,
    async createCheckout(i: { intentId: string }) {
      gw.checkouts++;
      return { preferenceId: `pref-${i.intentId}`, url: `https://mp.test/${i.intentId}` };
    },
    async fetchPayment() { throw new Error("no"); },
    async findPayments() { return []; },
    async refund() {},
  };
  return gw as typeof gw & PaymentGateway;
}

describe("cobro con saldo a favor", () => {
  it("saldo parcial: descuenta del total, debita el ledger y guarda el monto en el pedido", async () => {
    const demo = createDemoDb();
    give(demo, 3000);
    const placed = await createDeliveryOrder(demo.db, input(demo));
    assert.ok(placed.ok);
    assert.equal(placed.value.total, 6100); // 8500 + 600 - 3000
    assert.equal(Number(placed.value.credit_applied), 3000);
    assert.equal(client(demo).credit, 0);
    const ledger = demo.store.credit_ledger;
    assert.deepEqual(ledger.map((l) => [l.delta, l.motivo, l.idempotency_key, l.order_id]), [[-3000, "compra", `orden:${placed.value.id}:credito`, placed.value.id]]);
  });

  it("el saldo puede cubrir el pedido completo, envío incluido: no se llama a Mercado Pago", async () => {
    const demo = createDemoDb();
    give(demo, 20_000);
    const gw = fakeGateway();
    const started = await startOnlinePayment(demo.db, gw, input(demo, { paymentMethod: "Mercado Pago" }));
    assert.ok(started.ok);
    assert.equal(gw.checkouts, 0);
    assert.equal(started.value.total, 0);
    const order = started.value.order!;
    assert.equal(Number(order.total), 0);
    assert.equal(order.payment_method, null);
    assert.equal(Number(order.credit_applied), 9100);
    assert.match(String(order.notes), /Pagado con saldo a favor/);
    assert.equal(client(demo).credit, 10_900);
    assert.equal(demo.store.payment_intents.length, 0);
  });

  it("sin saldo todo sigue igual (sin asiento ni columna extra)", async () => {
    const demo = createDemoDb();
    const placed = await createDeliveryOrder(demo.db, input(demo));
    assert.ok(placed.ok);
    assert.equal(placed.value.total, 9100);
    assert.equal(demo.store.credit_ledger.length, 0);
  });

  it("expectedTotal: el total aceptado con saldo coincide; si el saldo cambió, hay que recotizar", async () => {
    const demo = createDemoDb();
    give(demo, 1000);
    assert.ok((await prepareDeliveryOrder(demo.db, input(demo, { expectedTotal: 8100 }))).ok);
    const changed = await prepareDeliveryOrder(demo.db, input(demo, { expectedTotal: 9100 }));
    assert.ok(!changed.ok);
    assert.equal(changed.code, "total_changed");
  });

  it("si el saldo ya no alcanza al colocar (otro pedido lo gastó) falla claro y no queda negativo", async () => {
    const demo = createDemoDb();
    give(demo, 3000);
    const prepared = await prepareDeliveryOrder(demo.db, input(demo));
    assert.ok(prepared.ok);
    give(demo, 1000); // otro pedido gastó parte del saldo
    const placed = await placeOrder(demo.db, prepared.value);
    assert.ok(!placed.ok);
    assert.equal(placed.code, "credit_insufficient");
    assert.match(placed.message, /saldo a favor/);
    assert.equal(client(demo).credit, 1000);
    assert.equal(demo.store.orders.filter((o) => o.items_desc === prepared.value.itemsDesc && Number(o.total) === 6100).length, 0);
  });

  it("reserva: un pago online pendiente aparta su saldo y otro pedido no puede gastarlo dos veces", async () => {
    const demo = createDemoDb();
    give(demo, 5000);
    const gw = fakeGateway();
    const first = await startOnlinePayment(demo.db, gw, input(demo, { paymentMethod: "Mercado Pago" }));
    assert.ok(first.ok);
    assert.equal(first.value.total, 4100); // 9100 - 5000, y MP cobra solo eso
    assert.equal(client(demo).credit, 5000); // todavía no se debitó: se cobra al aprobarse el pago
    const second = await createDeliveryOrder(demo.db, input(demo));
    assert.ok(second.ok);
    assert.equal(second.value.total, 9100); // el saldo apartado no se puede usar
    assert.equal(client(demo).credit, 5000);
  });

  it("al aprobarse el pago online se debita el saldo reservado", async () => {
    const demo = createDemoDb();
    give(demo, 5000);
    const gw = fakeGateway();
    const started = await startOnlinePayment(demo.db, gw, input(demo, { paymentMethod: "Mercado Pago" }));
    assert.ok(started.ok);
    const settled = await settlePayment(demo.db, gw, started.value.intentId, {
      id: 777, status: "approved", currency_id: "ARS", external_reference: started.value.intentId, transaction_amount: 4100,
    } as never);
    assert.ok(settled.ok && settled.value.kind === "order_created");
    assert.ok(settled.ok);
    assert.equal(client(demo).credit, 0);
    assert.equal(demo.store.credit_ledger.length, 1);
  });

  it("cancelar devuelve el saldo una sola vez (cliente, sistema y repetido)", async () => {
    const demo = createDemoDb();
    give(demo, 3000);
    const placed = await createDeliveryOrder(demo.db, input(demo));
    assert.ok(placed.ok);
    const cancelled = await cancelOrderForClient(demo.db, placed.value.id, String(client(demo).id), "cliente");
    assert.ok(cancelled.ok);
    assert.equal(client(demo).credit, 3000);
    assert.equal(await refundCreditForOrder(demo.db, placed.value.id), 0); // idempotente
    await cancelOrderBySystem(demo.db, placed.value.id, "mercadopago"); // ya cancelado: no suma otra vez
    assert.equal(client(demo).credit, 3000);
    assert.deepEqual(demo.store.credit_ledger.map((l) => [l.delta, l.motivo]), [[-3000, "compra"], [3000, "devolucion"]]);
  });

  it("cancelOrderBySystem también devuelve el saldo", async () => {
    const demo = createDemoDb();
    give(demo, 3000);
    const placed = await createDeliveryOrder(demo.db, input(demo));
    assert.ok(placed.ok);
    assert.equal(await cancelOrderBySystem(demo.db, placed.value.id, "fudo"), true);
    assert.equal(client(demo).credit, 3000);
  });
});

/* ------------------------------------------------------------ bot y Fudo */

describe("bot y Fudo", () => {
  const quote = {
    lines: [{ name: "Muzza", qty: 1, price: 8500 }],
    subtotal: 8500,
    delivery_fee: 600,
    total: 6100,
    resolved_address: "Av. Corrientes 1234",
  };

  it("el resumen muestra «Saldo a favor aplicado» entre Envío y Total", () => {
    const text = renderQuoteSummary({ ...quote, credit_applied: 3000 })!;
    const lines = text.split("\n");
    const envio = lines.findIndex((l) => l.startsWith("Envío:"));
    assert.match(lines[envio + 1]!, /^Saldo a favor aplicado: −\$3\.000$/);
    assert.match(lines[envio + 2]!, /^\*Total: \$6\.100\*$/);
  });

  it("sin saldo el resumen queda igual", () => {
    assert.ok(!renderQuoteSummary({ ...quote, total: 9100, credit_applied: 0 })!.includes("Saldo a favor"));
    assert.ok(!renderQuoteSummary({ ...quote, total: 9100 })!.includes("Saldo a favor"));
  });

  it("Fudo: el descuento derivado incluye el saldo aplicado (no hay que tocar el payload)", () => {
    const maps = { products: new Map([["p1", 11]]), payments: new Map([["Efectivo", 1]]) };
    const order = {
      id: "abcd0000-0000-4000-8000-000000000000",
      delivery_fee: 600,
      delivery_address: "Calle 1",
      payment_method: "Efectivo",
      notes: null,
      client: null,
      total: 6100, // 8500 + 600 - 3000 de saldo
      items: [{ product_id: "p1", name: "Muzza", qty: 1, unit_price: 8500, fudo_options: null }],
    };
    const built = buildFudoOrder(order as never, maps as never);
    assert.ok(built.ok);
    assert.deepEqual(built.body.order.discounts, [{ amount: 3000 }]);
  });
});
