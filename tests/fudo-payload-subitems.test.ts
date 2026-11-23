import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { buildFudoOrder } = await import("../workers/fudo-gateway/src/payload.ts");

const DOCENA = "00000001-0000-4000-8000-000000000000";
const PIZZA = "00000002-0000-4000-8000-000000000000";
const maps = { products: new Map([[DOCENA, 212], [PIZZA, 11]]), payments: new Map([["Efectivo", 1]]) };

const base = {
  id: "abcd0000-0000-4000-8000-000000000000",
  delivery_fee: 0,
  delivery_address: "Calle 1",
  payment_method: "Efectivo",
  notes: null,
  client: null,
};

describe("buildFudoOrder: opciones como subitems (sin verificar contra Fudo real)", () => {
  it("sin opciones no agrega subitems", () => {
    const r = buildFudoOrder({ ...base, total: 10000, items: [{ product_id: PIZZA, name: "Pizza", qty: 2, unit_price: 5000, fudo_options: null }] }, maps);
    assert.ok(r.ok);
    assert.deepEqual(r.body.order.items, [{ product: { id: 11 }, quantity: 2, price: 5000 }]);
  });

  it("con opciones expande la línea en items de cantidad 1 con subitems {productId, productGroupId, quantity, price}", () => {
    const options = [
      { qty: 8, name: "Carne", fudo_product_id: 200, group_fudo_id: 1, price: 0 },
      { qty: 4, name: "Jamón", fudo_product_id: 192, group_fudo_id: 1, price: 0 },
    ];
    const r = buildFudoOrder({ ...base, total: 72000, items: [{ product_id: DOCENA, name: "Docena", qty: 2, unit_price: 36000, fudo_options: options }] }, maps);
    assert.ok(r.ok);
    const sub = [{ productId: 200, productGroupId: 1, quantity: 8, price: 0 }, { productId: 192, productGroupId: 1, quantity: 4, price: 0 }];
    assert.deepEqual(r.body.order.items, [
      { product: { id: 212 }, quantity: 1, price: 36000, subitems: sub },
      { product: { id: 212 }, quantity: 1, price: 36000, subitems: sub },
    ]);
    assert.equal(r.body.order.discounts, undefined);
  });

  it("el precio de las opciones sale del unit_price: item base + subitems = unit_price", () => {
    const r = buildFudoOrder({
      ...base, total: 12000,
      items: [{ product_id: PIZZA, name: "Promo", qty: 1, unit_price: 12000, fudo_options: [{ qty: 2, fudo_product_id: 300, group_fudo_id: 3, price: 1000 }] }],
    }, maps);
    assert.ok(r.ok);
    assert.deepEqual(r.body.order.items, [{ product: { id: 11 }, quantity: 1, price: 10000, subitems: [{ productId: 300, productGroupId: 3, quantity: 2, price: 1000 }] }]);
    assert.equal(r.body.order.discounts, undefined);
  });

  it("opciones sin producto o grupo de Fudo se ignoran", () => {
    const r = buildFudoOrder({ ...base, total: 5000, items: [{ product_id: PIZZA, name: "Pizza", qty: 1, unit_price: 5000, fudo_options: [{ qty: 1, name: "x" }] }] }, maps);
    assert.ok(r.ok);
    assert.deepEqual(r.body.order.items, [{ product: { id: 11 }, quantity: 1, price: 5000 }]);
  });
});
