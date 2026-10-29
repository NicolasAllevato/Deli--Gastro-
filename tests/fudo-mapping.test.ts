import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

const {
  saveSchema, buildProductRows, buildPaymentRows, findUnmappedProducts, parseFudoCatalog,
  loadMapping, saveMapping, countSkippedOrders, safeCountSkippedOrders, EMPTY_SKIPPED, buildMapResponse, findUnknownFudoIds, applyCatalogNames, suggestionsFrom,
} = await import("../src/lib/fudo/mapping.ts");
const { processSaveRequest } = await import("../src/lib/fudo/save-request.ts");
const { fetchFudoCatalog } = await import("../src/lib/fudo/gateway.ts");
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

  it("lee el catálogo completo de la spec ({products:[...]}); los inactivos no son sugerencias pero sí válidos al guardar", async () => {
    const raw = { products: [
      { id: 7, name: "Pizza", active: true, price: 10, productCategoryId: 1, description: "" },
      { id: 8, name: "Vieja", active: false },
      { id: 3, name: "Agua" },
    ] };
    const catalog = parseFudoCatalog(raw);
    assert.equal(catalog.length, 3);
    assert.deepEqual(suggestionsFrom(catalog).map((c) => c.id), [3, 7]);
    // El id inactivo (8) se acepta al guardar; el 99 no existe.
    assert.deepEqual(findUnknownFudoIds([{ productId: UUID, fudoProductId: 8 }], catalog), []);
    assert.deepEqual(findUnknownFudoIds([{ productId: UUID, fudoProductId: 99 }], catalog), [99]);
    const { db, store } = createDemoDb();
    const first = String(store.products[0].id);
    const res = await processSaveRequest(db, { products: [{ productId: first, fudoProductId: 8 }] }, catalog);
    assert.equal(res.status, 200);
  });

  it("acepta también JSON:API y lista plana, trunca nombres y rechaza formas inválidas", () => {
    assert.deepEqual(
      parseFudoCatalog({ data: [{ id: "9", attributes: { name: "Pizza" } }, { id: "x", attributes: { name: "mal" } }] }),
      [{ id: 9, name: "Pizza", active: true }],
    );
    assert.deepEqual(parseFudoCatalog([{ id: 2, name: "Coca" }]), [{ id: 2, name: "Coca", active: true }]);
    assert.equal(parseFudoCatalog({ products: [{ id: 1, name: "x".repeat(300) }] })[0].name.length, 120);
    for (const bad of [null, undefined, "x", 5, {}, { products: "no" }, { products: [null, 1, { id: 0, name: "a" }] }]) {
      assert.deepEqual(parseFudoCatalog(bad), []);
    }
  });

  it("valida contra el catálogo completo pero sugiere como máximo 5000", () => {
    const products = Array.from({ length: 6000 }, (_, i) => ({ id: i + 1, name: `P${i}` }));
    const catalog = parseFudoCatalog({ products });
    assert.equal(catalog.length, 6000);
    assert.equal(suggestionsFrom(catalog).length, 5000);
    assert.deepEqual(findUnknownFudoIds([{ productId: UUID, fudoProductId: 5999 }], catalog), []);
  });

  it("valida ids contra el catálogo y usa los nombres del catálogo", () => {
    const catalog = [{ id: 5, name: "Real", active: true }];
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

  it("quitar un mapeo sin guardar productos no reencola", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    store.orders.push(order("a", {}));
    assert.equal(await saveMapping(db, saveSchema.parse({ removeProducts: [UUID] })), 0);
    assert.equal(store.orders[0].fudo_sync_status, "skipped");
  });

  it("no reencola al guardar solo medios de pago", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    store.orders.push(order("a", {}));
    assert.equal(await saveMapping(db, saveSchema.parse({ payments: [{ paymentMethod: "Tarjeta", fudoPaymentMethodId: 2 }] })), 0);
    assert.equal(store.orders[0].fudo_sync_status, "skipped");
  });
});

describe("mapeo Fudo: aviso de omitidos", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
  const order = (id: string, over: Record<string, unknown>) => ({
    id, status: "Recibidos", total: 10, fudo_sync_status: "skipped", fudo_order_id: null,
    fudo_error: "Productos sin mapear a Fudo: Burger", fudo_attempts: 0, created_at: hoursAgo(1), ...over,
  });

  it("byMapping cuenta solo los omitidos por mapeo, con recientes y el más viejo", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    const old = hoursAgo(50);
    store.orders.push(
      order("a", {}),
      order("b", { created_at: hoursAgo(5) }),
      order("c", { created_at: old }),
      order("d", { fudo_error: "Fudo /orders 400" }),
      order("e", { fudo_sync_status: "sent", fudo_error: null }),
      order("f", { fudo_order_id: 9 }),
    );
    const s = await countSkippedOrders(db);
    assert.deepEqual(s.byMapping, { count: 3, oldestAt: old, recentCount: 2 });
  });

  it("sin pedidos todo da 0 y sin fecha", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    assert.deepEqual(await countSkippedOrders(db), {
      byMapping: { count: 0, oldestAt: null, recentCount: 0 }, otherSkipped: 0, stuck: 0,
    });
  });

  it("las tres categorías son disjuntas y excluyen enviados y NULL", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    store.orders.push(
      order("map", {}),
      order("rechazo", { fudo_error: "Fudo /orders 400" }),
      order("sinlineas", { fudo_error: "El pedido no tiene líneas guardadas" }),
      order("agotado", { fudo_error: "timeout", fudo_attempts: 6 }),
      order("pend", { fudo_sync_status: "pending", fudo_error: null, created_at: minutesAgo(30) }),
      order("fail", { fudo_sync_status: "failed", fudo_error: "timeout", fudo_attempts: 2, created_at: minutesAgo(15) }),
      order("reciente", { fudo_sync_status: "pending", fudo_error: null, created_at: minutesAgo(3) }),
      order("sinintentos", { fudo_sync_status: "failed", fudo_attempts: 6, created_at: minutesAgo(30) }),
      order("sent", { fudo_sync_status: "sent", fudo_error: null }),
      order("nulo", { fudo_sync_status: null, fudo_error: null, created_at: minutesAgo(30) }),
      order("conid", { fudo_sync_status: "pending", fudo_order_id: 5, fudo_error: null, created_at: minutesAgo(30) }),
    );
    const s = await countSkippedOrders(db);
    assert.equal(s.byMapping.count, 1);
    assert.equal(s.otherSkipped, 3);
    assert.equal(s.stuck, 2);
  });

  it("solo mira los últimos 30 días", async () => {
    const { db, store } = createDemoDb();
    store.orders.length = 0;
    const days40 = hoursAgo(40 * 24);
    store.orders.push(
      order("viejo-map", { created_at: days40 }),
      order("viejo-otro", { created_at: days40, fudo_error: "Fudo /orders 400" }),
      order("viejo-stuck", { created_at: days40, fudo_sync_status: "pending", fudo_error: null }),
      order("nuevo", { created_at: hoursAgo(29 * 24) }),
    );
    const s = await countSkippedOrders(db);
    assert.deepEqual(s, { byMapping: { count: 1, oldestAt: s.byMapping.oldestAt, recentCount: 0 }, otherSkipped: 0, stuck: 0 });
  });

  it("paridad: recentCount coincide con lo que saveMapping reencola", async () => {
    const { db, store } = createDemoDb();
    const first = String(store.products[0].id);
    store.orders.length = 0;
    store.orders.push(
      order("a", {}), order("b", { created_at: hoursAgo(20) }), order("c", { created_at: hoursAgo(30) }),
      order("d", { fudo_error: "Fudo /orders 400" }),
    );
    const before = await countSkippedOrders(db);
    const requeued = await saveMapping(db, saveSchema.parse({ products: [{ productId: first, fudoProductId: 1 }] }));
    assert.equal(requeued, before.byMapping.recentCount);
    assert.equal(requeued, 2);
  });

  it("degradación: si una query falla devuelve el resumen vacío sin lanzar", async () => {
    const broken = { from() { throw new Error("db caída"); } } as unknown as Parameters<typeof countSkippedOrders>[0];
    await assert.rejects(countSkippedOrders(broken));
    assert.deepEqual(await safeCountSkippedOrders(broken), EMPTY_SKIPPED);
  });

  it("el GET incluye skipped sin tocar el resto", async () => {
    const { db } = createDemoDb();
    const mapping = await loadMapping(db);
    const skipped = { byMapping: { count: 2, oldestAt: null, recentCount: 1 }, otherSkipped: 1, stuck: 0 };
    const body = buildMapResponse(mapping, [{ id: 1, name: "A", active: true }, { id: 2, name: "B", active: false }], true, skipped);
    assert.deepEqual(body.skipped, skipped);
    assert.equal(body.gatewayConfigured, true);
    assert.deepEqual(body.catalog.map((c) => c.id), [1]);
    assert.equal(body.products, mapping.products);
  });
});

describe("ruta fudo-map (processSaveRequest)", () => {
  const catalog = [{ id: 5, name: "Real", active: true }];

  it("400 por id desconocido con catálogo no vacío, sin escribir nada", async () => {
    const { db, store } = createDemoDb();
    const first = String(store.products[0].id);
    const res = await processSaveRequest(db, { products: [{ productId: first, fudoProductId: 6 }] }, catalog);
    assert.equal(res.status, 400);
    assert.match((res.body as { error: string }).error, /no figura en el catálogo de Fudo: 6/);
    assert.equal(store.fudo_product_map.length, 0);
  });

  it("fail-open con catálogo vacío y respuesta con requeued", async () => {
    const { db, store } = createDemoDb();
    const first = String(store.products[0].id);
    const res = await processSaveRequest(db, { products: [{ productId: first, fudoProductId: 6, fudoName: "Cliente" }] }, []);
    assert.equal(res.status, 200);
    assert.equal((res.body as { requeued: number }).requeued, 0);
    assert.equal(store.fudo_product_map[0].fudo_name, "Cliente");
  });

  it("con catálogo usa el nombre del catálogo, no el del cliente", async () => {
    const { db, store } = createDemoDb();
    const first = String(store.products[0].id);
    await processSaveRequest(db, { products: [{ productId: first, fudoProductId: 5, fudoName: "Falso" }] }, catalog);
    assert.equal(store.fudo_product_map[0].fudo_name, "Real");
  });

  it("400 por cuerpo inválido", async () => {
    const { db } = createDemoDb();
    assert.equal((await processSaveRequest(db, null, [])).status, 400);
  });
});

describe("fetchFudoCatalog", () => {
  const config = { url: "https://gw.example", secret: "s" };
  const realFetch = globalThis.fetch;
  const realWarn = console.warn;
  const withFetch = async (impl: () => Promise<Response>, run: () => Promise<void>) => {
    globalThis.fetch = (async () => impl()) as typeof fetch;
    console.warn = () => {};
    try { await run(); } finally { globalThis.fetch = realFetch; console.warn = realWarn; }
  };

  it("devuelve el catálogo completo cuando responde bien", async () => {
    await withFetch(
      async () => new Response(JSON.stringify({ products: [{ id: 1, name: "A", active: false }] })),
      async () => assert.deepEqual(await fetchFudoCatalog(config), [{ id: 1, name: "A", active: false }]),
    );
  });

  it("devuelve [] si !res.ok, si falla el fetch o sin configuración", async () => {
    await withFetch(async () => new Response("x", { status: 502 }), async () => assert.deepEqual(await fetchFudoCatalog(config), []));
    await withFetch(async () => { throw new Error("red"); }, async () => assert.deepEqual(await fetchFudoCatalog(config), []));
    assert.deepEqual(await fetchFudoCatalog(null), []);
  });

  it("devuelve [] si supera 1 MB (por content-length o por bytes reales)", async () => {
    await withFetch(
      async () => new Response("{}", { headers: { "content-length": "2000000" } }),
      async () => assert.deepEqual(await fetchFudoCatalog(config), []),
    );
    const big = JSON.stringify({ products: [{ id: 1, name: "é".repeat(600_000) }] }); // < 1M caracteres, > 1 MB en bytes
    await withFetch(async () => new Response(big), async () => assert.deepEqual(await fetchFudoCatalog(config), []));
  });
});
