import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { executePlan, type QueryPlan } from "../src/lib/demo/query.ts";
import type { Tables } from "../src/lib/demo/seed.ts";

function emptyStore(): Tables {
  return {
    legal_acceptances: [],
    payment_intents: [],
    order_items: [],
    courier_locations: [], couriers: [],
    clients: [],
    orders: [],
    points_ledger: [],
    global_config: [],
    categories: [],
    products: [],
    reviews: [],
    order_events: [],
    delivery_zones: [],
    integration_secrets: [],
    wa_conversations: [],
    wa_messages: [],
    wa_campaigns: [],
  };
}

function plan(overrides: Partial<QueryPlan>): QueryPlan {
  return {
    table: "orders",
    action: "select",
    columns: "*",
    filters: [],
    order: [],
    limit: null,
    payload: null,
    onConflict: "",
    returning: false,
    count: false,
    head: false,
    single: "none",
    ...overrides,
  };
}

let store: Tables;

beforeEach(() => {
  store = emptyStore();
  store.orders.push(
    { id: "a", status: "Recibidos", total: 100, created_at: "2026-01-01T10:00:00Z" },
    { id: "b", status: "En Camino", total: 300, created_at: "2026-01-01T12:00:00Z" },
    { id: "c", status: "Recibidos", total: 200, created_at: "2026-01-01T11:00:00Z" },
  );
});

describe("not", () => {
  it("niega el filtro interno (not is null = tiene valor)", () => {
    store.orders.push({ id: "d", status: "Recibidos", total: 1, courier_name: "Diego" });
    const res = executePlan(
      plan({ filters: [{ op: "not", column: "courier_name", value: { op: "is", value: null } }] }),
      store,
    );
    assert.deepEqual((res.data as Array<{ id: string }>).map((r) => r.id), ["d"]);
  });

  it("niega un eq", () => {
    const res = executePlan(
      plan({ filters: [{ op: "not", column: "status", value: { op: "eq", value: "Recibidos" } }] }),
      store,
    );
    assert.deepEqual((res.data as Array<{ id: string }>).map((r) => r.id), ["b"]);
  });
});

describe("select", () => {
  it("filtra, ordena y limita", () => {
    const res = executePlan(
      plan({
        filters: [{ op: "eq", column: "status", value: "Recibidos" }],
        order: [{ column: "created_at", ascending: false }],
        limit: 1,
      }),
      store,
    );
    assert.deepEqual((res.data as Array<{ id: string }>).map((r) => r.id), ["c"]);
  });

  it("proyecta sólo las columnas pedidas", () => {
    const res = executePlan(plan({ columns: "id, total", limit: 1 }), store);
    assert.deepEqual(Object.keys((res.data as object[])[0]!).sort(), ["id", "total"]);
  });

  it("cuenta filas con head:true sin devolver datos", () => {
    const res = executePlan(plan({ count: true, head: true, filters: [{ op: "gte", column: "total", value: 200 }] }), store);
    assert.equal(res.count, 2);
    assert.equal(res.data, null);
  });

  it("soporta in, neq e ilike", () => {
    const inRes = executePlan(plan({ filters: [{ op: "in", column: "id", value: ["a", "b"] }] }), store);
    assert.equal((inRes.data as unknown[]).length, 2);
    const neqRes = executePlan(plan({ filters: [{ op: "neq", column: "status", value: "Recibidos" }] }), store);
    assert.equal((neqRes.data as unknown[]).length, 1);
    const likeRes = executePlan(plan({ filters: [{ op: "ilike", column: "status", value: "%camino" }] }), store);
    assert.equal((likeRes.data as unknown[]).length, 1);
  });

  it("single falla si no hay exactamente una fila; maybeSingle tolera cero", () => {
    const none = [{ op: "eq" as const, column: "id", value: "zzz" }];
    assert.equal(executePlan(plan({ filters: none, single: "single" }), store).error?.code, "PGRST116");
    const maybe = executePlan(plan({ filters: none, single: "maybe" }), store);
    assert.equal(maybe.error, null);
    assert.equal(maybe.data, null);
    assert.equal(executePlan(plan({ single: "maybe" }), store).error?.code, "PGRST116");
  });

  it("devuelve copias: mutar el resultado no altera el store", () => {
    const res = executePlan(plan({ filters: [{ op: "eq", column: "id", value: "a" }], single: "single" }), store);
    (res.data as { total: number }).total = 999;
    assert.equal(store.orders[0]!.total, 100);
  });

  it("rechaza tablas desconocidas", () => {
    const res = executePlan(plan({ table: "nope" as never }), store);
    assert.equal(res.error?.code, "42P01");
  });
});

describe("escrituras", () => {
  it("insert aplica defaults, genera id y devuelve la fila con returning", () => {
    const res = executePlan(
      plan({ action: "insert", payload: { items_desc: "1x Pizza", total: 50 }, returning: true, single: "single" }),
      store,
    );
    const row = res.data as Record<string, unknown>;
    assert.equal(row.status, "Recibidos");
    assert.equal(row.delivery_fee, 0);
    assert.equal(typeof row.id, "string");
    assert.equal(store.orders.length, 4);
  });

  it("update modifica sólo las filas filtradas", () => {
    executePlan(
      plan({ action: "update", payload: { status: "Cancelado" }, filters: [{ op: "eq", column: "id", value: "a" }] }),
      store,
    );
    assert.equal(store.orders.find((o) => o.id === "a")!.status, "Cancelado");
    assert.equal(store.orders.find((o) => o.id === "b")!.status, "En Camino");
  });

  it("upsert por clave pisa la fila existente y crea la nueva", () => {
    const upsert = (value: unknown) =>
      executePlan(plan({ table: "global_config", action: "upsert", payload: [{ key: "k", value }], onConflict: "key" }), store);
    upsert(1);
    upsert(2);
    assert.equal(store.global_config.length, 1);
    assert.equal(store.global_config[0]!.value, 2);
  });

  it("delete quita sólo las filas filtradas", () => {
    executePlan(plan({ action: "delete", filters: [{ op: "eq", column: "status", value: "Recibidos" }] }), store);
    assert.deepEqual(store.orders.map((o) => o.id), ["b"]);
  });
});
