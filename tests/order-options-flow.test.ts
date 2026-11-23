import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { confirmOrder, quoteOrder, isActionError } = await import("../src/lib/agent/order-actions.ts");
const { parseDraft } = await import("../src/lib/agent/draft.ts");

const T0 = new Date("2026-10-20T15:00:00.000Z");
const CONV = "11111111-1111-4111-8111-111111111111";
const NEAR = { label: "Av. Corrientes 1234, CABA", lat: -34.6037, lng: -58.3816 };
const CARNE = "c0000000-0000-4000-8000-000000000001";
const JAMON = "c0000000-0000-4000-8000-000000000002";
const DOCENA = "d0000000-0000-4000-8000-000000000000";
const PROMO = "e0000000-0000-4000-8000-000000000000";

function newDemo(withTables = true): DemoDb {
  return createDemoDb((s) => {
    setConfig(s, "horario_apertura", "00:00");
    setConfig(s, "horario_cierre", "23:59");
    setConfig(s, "docena_fudo_id", 212);
    setConfig(s, "docena_unidades", 12);
    setConfig(s, "empanada_gustos_map", { "31": 200, "32": 197 });
    s.wa_conversations.push({
      id: CONV, client_phone: "5491155550101", contact_name: "Sofía", client_id: null, state: {},
      human_takeover: false, last_inbound_at: null, updated_at: T0.toISOString(), created_at: T0.toISOString(),
    });
    const prod = (id: string, name: string, price: number, fudo_id: number, show_in_portal: number) =>
      s.products.push({ id, category_id: null, name, description: "", price, image_url: "", is_active: true, points_per_100: null, fudo_id, show_in_portal, source: "fudo", created_at: T0.toISOString(), updated_at: T0.toISOString() });
    prod(CARNE, "Empanada de carne", 3000, 31, 1);
    prod(JAMON, "Empanada de jamón y queso", 3000, 32, 1);
    prod(DOCENA, "Docena de empanadas", 30000, 212, 0);
    prod(PROMO, "Promo pizza + bebidas", 20000, 50, 1);
    if (!withTables) return;
    s.fudo_modifier_groups.push(
      { fudo_id: 1, name: "Elige tu Relleno", min_qty: null, max_qty: 1, required: 0, kind: "EXTRAS" },
      { fudo_id: 3, name: "bebidas promo", min_qty: 2, max_qty: 2, required: 0, kind: "EXTRAS" },
    );
    s.fudo_modifier_options.push(
      { fudo_id: 1, group_fudo_id: 1, product_fudo_id: 200, name: "Carne cortada a cuchillo", price_cents: 0, position: 0, is_active: true },
      { fudo_id: 2, group_fudo_id: 1, product_fudo_id: 197, name: "Jamón y queso", price_cents: 0, position: 1, is_active: true },
      { fudo_id: 10, group_fudo_id: 3, product_fudo_id: 300, name: "Pepsi", price_cents: 0, position: 0, is_active: true },
      { fudo_id: 11, group_fudo_id: 3, product_fudo_id: 301, name: "Sprite", price_cents: 50000, position: 1, is_active: true },
    );
    s.fudo_product_groups.push({ product_fudo_id: 212, group_fudo_id: 1 }, { product_fudo_id: 50, group_fudo_id: 3 });
  });
}

const deps = (demo: DemoDb, messageId: string) => ({
  db: demo.db, conversationId: CONV, messageId, dryRun: false, now: () => T0,
  geocode: async () => [NEAR], gateway: () => null,
});
const quote = (demo: DemoDb, items: Array<{ product_id: string; qty: number; options?: Array<{ option_id: number; qty: number }> }>) =>
  quoteOrder(deps(demo, "w1"), { items, address: "Av. Corrientes 1234" });

describe("empanadas sueltas -> docenas en la cotización", () => {
  it("31 de carne: 2 docenas con 12 gustos cada una + 7 sueltas, precios del servidor", async () => {
    const demo = newDemo();
    const r = await quote(demo, [{ product_id: CARNE, qty: 31 }]);
    assert.ok(!isActionError(r), JSON.stringify(r));
    assert.deepEqual(r.lines, [
      { name: "Docena de empanadas", qty: 2, price: 30000, options: [{ name: "Carne cortada a cuchillo", qty: 12 }] },
      { name: "Empanada de carne", qty: 7, price: 3000 },
    ]);
    assert.equal(r.subtotal, 2 * 30000 + 7 * 3000);
    // El borrador conserva las opciones (si no, el pedido se confirmaría sin gustos).
    const draft = parseDraft(demo.store.wa_conversations[0]!.state);
    assert.deepEqual(draft?.items[0], { productId: DOCENA, qty: 2, options: [{ option_id: 1, qty: 12 }] });
  });

  it("confirmar guarda los gustos en order_items (fudo_options, fudo_product_id, is_combo=0)", async () => {
    const demo = newDemo();
    const q = await quote(demo, [{ product_id: CARNE, qty: 20 }, { product_id: JAMON, qty: 11 }]);
    assert.ok(!isActionError(q), JSON.stringify(q));
    const c = await confirmOrder(deps(demo, "w2"), { payment_method: "Efectivo" });
    assert.ok(!isActionError(c), JSON.stringify(c));
    const items = demo.store.order_items;
    assert.equal(items.length, 3);
    const docenas = items.filter((i) => i.product_id === DOCENA);
    assert.equal(docenas.length, 2);
    assert.equal(docenas[0]!.fudo_product_id, 212);
    assert.equal(docenas[0]!.is_combo, false);
    assert.deepEqual(docenas[1]!.fudo_options, [
      { qty: 8, name: "Carne cortada a cuchillo", product_id: CARNE, fudo_product_id: 200, group_fudo_id: 1, option_fudo_id: 1, price: 0 },
      { qty: 4, name: "Jamón y queso", product_id: JAMON, fudo_product_id: 197, group_fudo_id: 1, option_fudo_id: 2, price: 0 },
    ]);
    assert.equal(items.find((i) => i.product_id === JAMON)!.fudo_options, null);
    const order = demo.store.orders.at(-1)!;
    assert.equal(Number(order.total), 2 * 30000 + 7 * 3000 + Number(order.delivery_fee));
    assert.match(String(order.items_desc), /Docena de empanadas \(12 Carne cortada a cuchillo\)/);
  });

  it("sin producto docena en products no se empaqueta", async () => {
    const demo = newDemo();
    demo.store.products = demo.store.products.filter((p) => p.id !== DOCENA);
    const r = await quote(demo, [{ product_id: CARNE, qty: 31 }]);
    assert.ok(!isActionError(r));
    assert.deepEqual(r.lines.map((l) => [l.name, l.qty]), [["Empanada de carne", 31]]);
  });

  it("sin las tablas de modificadores todo sigue igual que antes", async () => {
    const demo = newDemo(false);
    const r = await quote(demo, [{ product_id: CARNE, qty: 31 }]);
    assert.ok(!isActionError(r));
    assert.deepEqual(r.lines.map((l) => [l.name, l.qty]), [["Empanada de carne", 31]]);
  });
});

describe("validación de opciones en la cotización", () => {
  it("docena sin gustos pide elegir", async () => {
    const r = await quote(newDemo(), [{ product_id: DOCENA, qty: 1 }]);
    assert.ok(isActionError(r));
    assert.match(r.error, /Faltan gustos de la docena: elegí 12 en total/);
  });

  it("opción de otro grupo se rechaza", async () => {
    const r = await quote(newDemo(), [{ product_id: DOCENA, qty: 1, options: [{ option_id: 10, qty: 12 }] }]);
    assert.ok(isActionError(r));
    assert.match(r.error, /no corresponde/);
  });

  it("promo con bebidas promo min 2: sin elegir lista los nombres; con elección suma el precio del servidor", async () => {
    const demo = newDemo();
    const bad = await quote(demo, [{ product_id: PROMO, qty: 1 }]);
    assert.ok(isActionError(bad));
    assert.match(bad.error, /Pepsi, Sprite/);
    const ok = await quote(demo, [{ product_id: PROMO, qty: 2, options: [{ option_id: 10, qty: 1 }, { option_id: 11, qty: 1 }] }]);
    assert.ok(!isActionError(ok), JSON.stringify(ok));
    assert.equal(ok.lines[0]!.price, 20500);
    assert.equal(ok.subtotal, 41000);
    assert.deepEqual(ok.lines[0]!.options, [{ name: "Pepsi", qty: 1 }, { name: "Sprite", qty: 1 }]);
  });

  it("dos docenas con distintos gustos quedan en líneas separadas", async () => {
    const demo = newDemo();
    const r = await quote(demo, [
      { product_id: DOCENA, qty: 1, options: [{ option_id: 1, qty: 12 }] },
      { product_id: DOCENA, qty: 1, options: [{ option_id: 2, qty: 12 }] },
    ]);
    assert.ok(!isActionError(r), JSON.stringify(r));
    assert.equal(r.lines.length, 2);
  });
});
