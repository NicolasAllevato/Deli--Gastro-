import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

const {
  saveSchema, buildProductRows, buildPaymentRows, findUnmappedProducts, parseFudoCatalog,
  loadMapping, saveMapping, PAYMENT_METHODS,
} = await import("../src/lib/fudo/mapping.ts");

const UUID = "11111111-1111-4111-8111-111111111111";

describe("mapeo Fudo: validación", () => {
  it("acepta ids enteros positivos y rechaza el resto", () => {
    assert.ok(saveSchema.safeParse({ products: [{ productId: UUID, fudoProductId: 12 }] }).success);
    for (const bad of [0, -1, 1.5, "7", 3_000_000_000]) {
      assert.equal(saveSchema.safeParse({ products: [{ productId: UUID, fudoProductId: bad }] }).success, false);
    }
    assert.equal(saveSchema.safeParse({ products: [{ productId: "x", fudoProductId: 1 }] }).success, false);
  });

  it("solo admite los medios de pago de la app y exige algún cambio", () => {
    assert.equal(saveSchema.safeParse({ payments: [{ paymentMethod: "Bitcoin", fudoPaymentMethodId: 1 }] }).success, false);
    assert.equal(saveSchema.safeParse({}).success, false);
    assert.ok(saveSchema.safeParse({ removePayments: ["Efectivo"] }).success);
  });
});

describe("mapeo Fudo: armado de filas", () => {
  it("deduplica y limpia el nombre", () => {
    const rows = buildProductRows([
      { productId: UUID, fudoProductId: 1, fudoName: " Hamb " },
      { productId: UUID, fudoProductId: 2, fudoName: "  " },
    ]);
    assert.deepEqual(rows, [{ product_id: UUID, fudo_product_id: 2, fudo_name: null }]);
    assert.deepEqual(buildPaymentRows([{ paymentMethod: "Tarjeta", fudoPaymentMethodId: 5 }]),
      [{ payment_method: "Tarjeta", fudo_payment_method_id: 5 }]);
  });

  it("detecta solo los productos activos sin mapear", () => {
    const list = [
      { isActive: true, fudoProductId: null },
      { isActive: true, fudoProductId: 3 },
      { isActive: false, fudoProductId: null },
    ];
    assert.equal(findUnmappedProducts(list).length, 1);
  });

  it("lee el catálogo de Fudo en formato JSON:API o lista plana", () => {
    assert.deepEqual(
      parseFudoCatalog({ data: [{ id: "9", attributes: { name: "Pizza" } }, { id: "x", attributes: { name: "mal" } }] }),
      [{ id: 9, name: "Pizza" }],
    );
    assert.deepEqual(parseFudoCatalog([{ id: 2, name: "Coca" }]), [{ id: 2, name: "Coca" }]);
    assert.deepEqual(parseFudoCatalog(null), []);
  });
});

describe("mapeo Fudo: base", () => {
  it("lista productos sin mapear, guarda, actualiza y borra", async () => {
    const { db, store } = createDemoDb();
    const active = store.products.filter((p) => p.is_active).length;
    const first = String(store.products[0].id);

    const empty = await loadMapping(db);
    assert.equal(empty.unmappedProducts, active);
    assert.equal(empty.unmappedPayments, PAYMENT_METHODS.length);

    await saveMapping(db, saveSchema.parse({
      products: [{ productId: first, fudoProductId: 10, fudoName: "Burger" }],
      payments: [{ paymentMethod: "Efectivo", fudoPaymentMethodId: 1 }],
    }));
    let state = await loadMapping(db);
    assert.equal(state.products.find((p) => p.id === first)?.fudoProductId, 10);
    assert.equal(state.payments.find((p) => p.method === "Efectivo")?.fudoPaymentMethodId, 1);
    assert.equal(state.unmappedPayments, PAYMENT_METHODS.length - 1);

    await saveMapping(db, saveSchema.parse({ products: [{ productId: first, fudoProductId: 11 }] }));
    assert.equal(store.fudo_product_map.length, 1);
    assert.equal(store.fudo_product_map[0].fudo_product_id, 11);

    await saveMapping(db, saveSchema.parse({ removeProducts: [first], removePayments: ["Efectivo"] }));
    state = await loadMapping(db);
    assert.equal(store.fudo_product_map.length, 0);
    assert.equal(state.unmappedPayments, PAYMENT_METHODS.length);
  });
});
