import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

const {
  saveSchema, buildProductRows, buildPaymentRows, findUnmappedProducts, parseFudoCatalog,
  loadMapping, saveMapping, findUnknownFudoIds, applyCatalogNames,
} = await import("../src/lib/fudo/mapping.ts");
const { PAYMENT_METHODS } = await import("../src/lib/orders.ts");

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

  it("lee el catálogo con la forma real de la spec ({products:[...]}) y saltea inactivos", () => {
    const raw = { products: [
      { id: 7, name: "Pizza", active: true, price: 10, productCategoryId: 1, description: "" },
      { id: 8, name: "Vieja", active: false },
      { id: 3, name: "Agua" },
    ] };
    assert.deepEqual(parseFudoCatalog(raw), [{ id: 3, name: "Agua" }, { id: 7, name: "Pizza" }]);
  });

  it("acepta también JSON:API y lista plana, trunca nombres y rechaza formas inválidas", () => {
    assert.deepEqual(
      parseFudoCatalog({ data: [{ id: "9", attributes: { name: "Pizza" } }, { id: "x", attributes: { name: "mal" } }] }),
      [{ id: 9, name: "Pizza" }],
    );
    assert.deepEqual(parseFudoCatalog([{ id: 2, name: "Coca" }]), [{ id: 2, name: "Coca" }]);
    assert.equal(parseFudoCatalog({ products: [{ id: 1, name: "x".repeat(300) }] })[0].name.length, 120);
    for (const bad of [null, undefined, "x", 5, {}, { products: "no" }, { products: [null, 1, { id: 0, name: "a" }] }]) {
      assert.deepEqual(parseFudoCatalog(bad), []);
    }
  });

  it("limita el catálogo a 5000 ítems", () => {
    const products = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1, name: `P${i}` }));
    assert.equal(parseFudoCatalog({ products }).length, 5000);
  });

  it("valida ids contra el catálogo y usa los nombres del catálogo", () => {
    const catalog = [{ id: 5, name: "Real" }];
    const products = [{ productId: UUID, fudoProductId: 5, fudoName: "Falso" }, { productId: UUID, fudoProductId: 6, fudoName: "Typo" }];
    assert.deepEqual(findUnknownFudoIds(products, catalog), [6]);
    assert.deepEqual(findUnknownFudoIds(products, []), []);
    assert.equal(applyCatalogNames(products, catalog)[0].fudoName, "Real");
    assert.equal(applyCatalogNames(products, catalog)[1].fudoName, "Typo");
  });

  it("trunca fudoName y rechaza guardar y quitar el mismo producto", () => {
    const ok = saveSchema.parse({ products: [{ productId: UUID, fudoProductId: 1, fudoName: "n".repeat(200) }] });
    assert.equal(ok.products[0].fudoName?.length, 120);
    const both = saveSchema.safeParse({ products: [{ productId: UUID, fudoProductId: 1 }], removeProducts: [UUID] });
    assert.equal(both.success, false);
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

describe("mapeo Fudo: reencolado de omitidos", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const order = (id: string, over: Record<string, unknown>) => ({
    id, status: "Recibidos", total: 10, fudo_sync_status: "skipped", fudo_order_id: null,
    fudo_error: "Productos sin mapear a Fudo: Burger", fudo_attempts: 2, created_at: hoursAgo(1), ...over,
  });

  it("reencola solo los omitidos recientes por falta de mapeo", async () => {
    const { db, store } = createDemoDb();
    const first = String(store.products[0].id);
    store.orders.length = 0;
    store.orders.push(
      order("a", {}),
      order("b", { created_at: hoursAgo(30) }),
      order("c", { fudo_error: "Fudo /orders 400" }),
      order("d", { fudo_order_id: 99 }),
      order("e", { fudo_sync_status: "sent" }),
    );
    const n = await saveMapping(db, saveSchema.parse({ products: [{ productId: first, fudoProductId: 1 }] }));
    assert.equal(n, 1);
    const a = store.orders.find((o) => o.id === "a");
    assert.equal(a?.fudo_sync_status, "pending");
    assert.equal(a?.fudo_error, null);
    assert.equal(a?.fudo_attempts, 0);
    for (const id of ["b", "c", "d"]) assert.equal(store.orders.find((o) => o.id === id)?.fudo_sync_status, "skipped");
    assert.equal(store.orders.find((o) => o.id === "e")?.fudo_sync_status, "sent");
  });

  it("no reencola al guardar solo medios de pago", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    store.orders.push(order("a", {}));
    assert.equal(await saveMapping(db, saveSchema.parse({ payments: [{ paymentMethod: "Tarjeta", fudoPaymentMethodId: 2 }] })), 0);
    assert.equal(store.orders[0].fudo_sync_status, "skipped");
  });
});
