import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";

const sales = await import("../src/lib/data/fudo-sales.ts");
type GatewayCall = { method: string; path: string; body: unknown };
type GatewayResult = Awaited<ReturnType<import("../src/lib/data/fudo-sales.ts").FudoWriteGateway>>;

const admin = { kind: "admin", userId: "u-admin" } as const;
const cliente = { kind: "cliente", userId: "u-cli" } as const;
const repartidor = { kind: "repartidor", userId: "u-rep" } as const;
const ORDER = "7b0c3c55-1111-4222-8333-444455556666";

function gateway(handler: (c: GatewayCall) => GatewayResult) {
  const calls: GatewayCall[] = [];
  const gw = async (method: "POST" | "PATCH", path: string, body: unknown) => {
    const c = { method, path, body };
    calls.push(c);
    return handler(c);
  };
  return { gw, calls };
}

const okSale = (c: GatewayCall): GatewayResult =>
  c.path === "/sales"
    ? { ok: true, status: 201, data: { saleId: 99, partial: false, linesCreated: 2, failedLines: [], existing: false } }
    : c.path === "/payments"
      ? { ok: true, status: 201, data: { paymentId: 5 } }
      : { ok: true, status: 200, data: {} };

let db: ReturnType<typeof createTestDb>;

function seed(opts: { channel?: string; fudoOrderId?: number | null; status?: string; mapSecond?: boolean; address?: string | null } = {}) {
  db.raw.exec(`
    INSERT INTO clients (id, name, phone) VALUES ('c1', 'Ana', '11 2233-4455');
    INSERT INTO products (id, name, price_cents) VALUES ('p1', 'Muzza', 150000), ('p2', 'Coca', 90000);
    INSERT INTO fudo_product_map (product_id, fudo_product_id) VALUES ('p1', 10);
    INSERT INTO fudo_payment_map (payment_method, fudo_payment_method_id) VALUES ('Efectivo', 3);
  `);
  if (opts.mapSecond !== false) db.raw.exec("UPDATE products SET fudo_id = 11 WHERE id = 'p2'");
  db.raw
    .prepare(
      "INSERT INTO orders (id, client_id, status, items_desc, total_cents, delivery_address, payment_method, channel, fudo_order_id) VALUES (?, 'c1', ?, 'x', 390000, ?, 'Efectivo', ?, ?)",
    )
    .run(ORDER, opts.status ?? "En Preparación", opts.address === undefined ? "Calle 1 123" : opts.address, opts.channel ?? "web", opts.fudoOrderId ?? null);
  db.raw.exec(`
    INSERT INTO order_items (id, order_id, product_id, name, qty, unit_price_cents) VALUES
      ('i1', '${ORDER}', 'p1', 'Muzza', 2, 150000), ('i2', '${ORDER}', 'p2', 'Coca', 1, 90000);
  `);
}

const order = () =>
  db.raw.prepare("SELECT fudo_sale_id, fudo_sale_sync, fudo_sale_error, fudo_sale_paid_at, fudo_sale_closed_at, fudo_sale_canceled_at FROM orders WHERE id = ?").get(ORDER) as Record<string, unknown>;
const audits = () =>
  (db.raw.prepare("SELECT operation, ok, fudo_id, actor FROM fudo_writes ORDER BY created_at, rowid").all() as Array<Record<string, unknown>>).map((r) => ({ ...r }));

describe("ventas en Fudo al confirmar un pedido", () => {
  beforeEach(() => {
    db = createTestDb();
  });

  it("solo el staff puede sincronizar (cliente y repartidor → Forbidden)", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    await assert.rejects(() => sales.pushOrderSale(db, cliente, gw, ORDER), /No autorizado/);
    await assert.rejects(() => sales.pushOrderSale(db, repartidor, gw, ORDER), /No autorizado/);
    await assert.rejects(() => sales.listPendingSales(db, cliente), /No autorizado/);
    await assert.rejects(() => sales.onOrderStatusChange(db, repartidor, gw, ORDER, "Finalizados"), /No autorizado/);
    assert.equal(calls.length, 0);
  });

  it("crea la venta con líneas mapeadas, delivery con dirección y teléfono, y la audita", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    const r = await sales.pushOrderSale(db, admin, gw, ORDER);
    assert.equal(r.result, "sent");
    assert.equal(calls.length, 1);
    const body = calls[0].body as { externalId: string; lines: unknown[]; delivery: { address: string; phone: string } };
    assert.equal(body.externalId, ORDER);
    assert.deepEqual(body.lines, [
      { fudoProductId: 10, quantity: 2, price: 1500, comment: null },
      { fudoProductId: 11, quantity: 1, price: 900, comment: null },
    ]);
    assert.deepEqual(body.delivery, { address: "Calle 1 123", phone: "11 2233-4455" });
    assert.equal(order().fudo_sale_id, 99);
    assert.equal(order().fudo_sale_sync, "sent");
    assert.deepEqual(audits(), [{ operation: "create_sale", ok: 1, fudo_id: 99, actor: "admin:u-admin" }]);
  });

  it("es idempotente: nunca crea dos ventas para un pedido", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    await sales.pushOrderSale(db, admin, gw, ORDER);
    const again = await sales.pushOrderSale(db, admin, gw, ORDER);
    assert.equal(again.result, "skipped");
    assert.equal(calls.length, 1);
  });

  it("dos confirmaciones simultáneas generan una sola llamada", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    const [a, b] = await Promise.all([sales.pushOrderSale(db, admin, gw, ORDER), sales.pushOrderSale(db, admin, gw, ORDER)]);
    assert.deepEqual([a.result, b.result].sort(), ["sent", "skipped"]);
    assert.equal(calls.length, 1);
  });

  it("no re-envía pedidos que vinieron de Fudo", async () => {
    seed({ channel: "fudo" });
    const { gw, calls } = gateway(okSale);
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "skipped");
    db = createTestDb();
    seed({ fudoOrderId: 1234 });
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "skipped");
    assert.equal(calls.length, 0);
  });

  it("pedidos del bot (canal whatsapp) no crean venta salvo bot_orders_fudo_enabled = true", async () => {
    seed({ channel: "whatsapp" });
    const { gw, calls } = gateway(okSale);
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "skipped");
    db.raw.exec("INSERT INTO global_config (key, value) VALUES ('bot_orders_fudo_enabled', 'false')");
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "skipped");
    assert.equal(calls.length, 0);
    db.raw.exec("UPDATE global_config SET value = 'true' WHERE key = 'bot_orders_fudo_enabled'");
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "sent");
    assert.equal(calls.length, 1);
  });

  it("con escrituras apagadas el pedido queda pendiente (sin tirar) y aparece en el admin", async () => {
    seed();
    const { gw } = gateway(() => ({ ok: false, status: 403, error: "Escrituras en Fudo deshabilitadas.", code: "WRITES_DISABLED" }));
    const r = await sales.pushOrderSale(db, admin, gw, ORDER);
    assert.equal(r.result, "pending");
    assert.equal(order().fudo_sale_sync, "pending");
    assert.match(String(order().fudo_sale_error), /deshabilitadas/);
    assert.deepEqual(audits().map((a) => a.ok), [0]);
    const pending = await sales.listPendingSales(db, admin);
    assert.equal(pending.length, 1);
    assert.equal(pending[0].id, ORDER);
  });

  it("si el gateway tira, el pedido queda pendiente", async () => {
    seed();
    const gw = async () => {
      throw new Error("red caída");
    };
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "pending");
    assert.equal(order().fudo_sale_sync, "pending");
  });

  it("producto sin mapear: no llama a Fudo y queda pendiente con el motivo", async () => {
    seed({ mapSecond: false });
    const { gw, calls } = gateway(okSale);
    const r = await sales.pushOrderSale(db, admin, gw, ORDER);
    assert.equal(r.result, "pending");
    assert.match(String(order().fudo_sale_error), /Coca/);
    assert.equal(calls.length, 0);
  });

  it("el reintento manda la venta que había quedado pendiente", async () => {
    seed();
    const off = gateway(() => ({ ok: false, status: 502, error: "Fudo no respondió" }));
    await sales.pushOrderSale(db, admin, off.gw, ORDER);
    const on = gateway(okSale);
    const r = await sales.retryOrderSale(db, admin, on.gw, ORDER);
    assert.equal(r.result, "sent");
    assert.equal(order().fudo_sale_id, 99);
    assert.equal((await sales.listPendingSales(db, admin)).length, 0);
  });

  it("venta parcial queda marcada para revisar", async () => {
    seed();
    const { gw } = gateway(() => ({ ok: true, status: 201, data: { saleId: 99, partial: true, linesCreated: 1, failedLines: [1], existing: false } }));
    assert.equal((await sales.pushOrderSale(db, admin, gw, ORDER)).result, "partial");
    assert.equal(order().fudo_sale_sync, "partial");
  });

  it("al finalizar registra el pago con el medio mapeado y cierra la venta (una sola vez)", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    await sales.pushOrderSale(db, admin, gw, ORDER);
    db.raw.exec(`UPDATE orders SET status = 'Finalizados' WHERE id = '${ORDER}'`);
    await sales.onOrderStatusChange(db, admin, gw, ORDER, "Finalizados");
    await sales.onOrderStatusChange(db, admin, gw, ORDER, "Finalizados");
    const pay = calls.filter((c) => c.path === "/payments");
    assert.equal(pay.length, 1);
    assert.deepEqual(pay[0].body, { saleId: 99, paymentMethodId: 3, amount: 3900 });
    const close = calls.filter((c) => c.path === "/sales/99/state");
    assert.deepEqual(close.map((c) => c.body), [{ state: "CLOSED" }]);
    assert.ok(order().fudo_sale_paid_at);
    assert.ok(order().fudo_sale_closed_at);
  });

  it("al cancelar anula la venta en Fudo", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    await sales.pushOrderSale(db, admin, gw, ORDER);
    await sales.onOrderStatusChange(db, admin, gw, ORDER, "Cancelado");
    assert.deepEqual(calls.at(-1), { method: "PATCH", path: "/sales/99/state", body: { state: "CANCELED" } });
    assert.ok(order().fudo_sale_canceled_at);
    assert.deepEqual(audits().map((a) => a.operation), ["create_sale", "cancel_sale"]);
  });

  it("si falla la anulación se puede volver a intentar", async () => {
    seed();
    const ok = gateway(okSale);
    await sales.pushOrderSale(db, admin, ok.gw, ORDER);
    const bad = gateway(() => ({ ok: false, status: 502, error: "x" }));
    await sales.onOrderStatusChange(db, admin, bad.gw, ORDER, "Cancelado");
    assert.equal(order().fudo_sale_canceled_at, null);
    assert.match(String(order().fudo_sale_error), /anular/i);
  });

  it("confirmar (En Preparación) dispara la creación", async () => {
    seed();
    const { gw, calls } = gateway(okSale);
    await sales.onOrderStatusChange(db, admin, gw, ORDER, "En Preparación");
    assert.equal(calls[0].path, "/sales");
  });

  it("pago con resultado incierto (timeout/5xx): no libera el cobro para no duplicarlo", async () => {
    seed();
    const ok = gateway(okSale);
    await sales.pushOrderSale(db, admin, ok.gw, ORDER);
    db.raw.exec(`UPDATE orders SET status = 'Finalizados' WHERE id = '${ORDER}'`);
    const flaky = gateway((c) => (c.path === "/payments" ? { ok: false, status: 0, error: "timeout" } : okSale(c)));
    await sales.onOrderStatusChange(db, admin, flaky.gw, ORDER, "Finalizados");
    assert.ok(order().fudo_sale_paid_at, "el pago incierto queda tomado");
    assert.match(String(order().fudo_sale_error), /verificar/i);
    assert.equal(flaky.calls.filter((c) => c.path === "/sales/99/state").length, 0, "no cierra sin pago confirmado");
    assert.ok((await sales.listPendingSales(db, admin)).some((p) => p.id === ORDER));
    const again = gateway(okSale);
    await sales.retryOrderSale(db, admin, again.gw, ORDER);
    assert.equal(again.calls.filter((c) => c.path === "/payments").length, 0);
  });

  it("pago rechazado de forma definitiva (escrituras apagadas) sí se puede reintentar", async () => {
    seed();
    await sales.pushOrderSale(db, admin, gateway(okSale).gw, ORDER);
    db.raw.exec(`UPDATE orders SET status = 'Finalizados' WHERE id = '${ORDER}'`);
    const off = gateway((c) => (c.path === "/payments" ? { ok: false, status: 403, error: "off", code: "WRITES_DISABLED" } : okSale(c)));
    await sales.onOrderStatusChange(db, admin, off.gw, ORDER, "Finalizados");
    assert.equal(order().fudo_sale_paid_at, null);
    const on = gateway(okSale);
    await sales.retryOrderSale(db, admin, on.gw, ORDER);
    assert.equal(on.calls.filter((c) => c.path === "/payments").length, 1);
    assert.ok(order().fudo_sale_closed_at);
  });

  it("finalizar sin haber pasado por En Preparación igual crea la venta y la cobra", async () => {
    seed({ status: "Finalizados" });
    const { gw, calls } = gateway(okSale);
    await sales.onOrderStatusChange(db, admin, gw, ORDER, "Finalizados");
    assert.deepEqual(calls.map((c) => c.path), ["/sales", "/payments", "/sales/99/state"]);
  });

  it("si el pedido se canceló mientras se creaba la venta, la anula", async () => {
    seed();
    const { gw, calls } = gateway((c) => {
      if (c.path === "/sales") db.raw.exec(`UPDATE orders SET status = 'Cancelado' WHERE id = '${ORDER}'`);
      return okSale(c);
    });
    await sales.pushOrderSale(db, admin, gw, ORDER);
    assert.deepEqual(calls.at(-1), { method: "PATCH", path: "/sales/99/state", body: { state: "CANCELED" } });
    assert.ok(order().fudo_sale_canceled_at);
  });

  it("pedido de retiro: sin datos de delivery", async () => {
    seed({ address: null });
    const { gw, calls } = gateway(okSale);
    await sales.pushOrderSale(db, admin, gw, ORDER);
    assert.equal((calls[0].body as { delivery: unknown }).delivery, null);
  });
});
