/**
 * Etapa 1 del corte: motor de planes (cliente compatible con supabase-js) sobre D1.
 * Con DATA_BACKEND=d1 todas las rutas que usan createAdminClient() pasan por acá.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { executeD1Plan, type Plan } from "../src/lib/data/plan-sql.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

const plan = (p: Partial<Plan> & { table: string }): Plan => ({
  action: "select", columns: "*", filters: [], order: [], limit: null, payload: null, onConflict: "",
  returning: false, count: false, head: false, single: "none", ...p,
});
const run = (p: Partial<Plan> & { table: string }) => executeD1Plan(db, actors.system, plan(p));

describe("lecturas", () => {
  it("montos en pesos, booleanos y JSON como en Supabase", async () => {
    const r = await run({ table: "orders", filters: [{ op: "eq", column: "id", value: "o-ana-1" }], single: "single" });
    assert.equal(r.error, null);
    const o = r.data as Record<string, unknown>;
    assert.equal(o.total, 12500.5);
    assert.equal(o.delivered_in_app, false);
    assert.ok(!("total_cents" in o));
  });
  it("filtros, orden, límite, offset y conteo", async () => {
    const r = await run({
      table: "orders", columns: "id, total", filters: [{ op: "in", column: "client_id", value: ["c-ana", "c-beto"] }, { op: "gte", column: "total", value: 5000 }],
      order: [{ column: "total", ascending: false }], limit: 2, offset: 1, count: true,
    });
    assert.equal(r.count, 3, "12500,50 · 7000 · 5000 (1500 queda afuera)");
    assert.deepEqual((r.data as Record<string, unknown>[]).map((x) => x.id), ["o-beto-1", "o-ana-2"]);
  });
  it("embebidos: hijos (orders → order_items) y padre (products → categories)", async () => {
    const o = (await run({ table: "orders", columns: "id, order_items(*)", filters: [{ op: "eq", column: "id", value: "o-ana-1" }], single: "single" })).data as Record<string, unknown>;
    const items = o.order_items as Record<string, unknown>[];
    assert.equal(items.length, 1);
    assert.equal(items[0].unit_price, 12500.5);
    const p = (await run({ table: "products", columns: "id,name,categories(name)", filters: [{ op: "eq", column: "id", value: "p-on" }], single: "single" })).data as Record<string, unknown>;
    assert.deepEqual(p, { id: "p-on", name: "Muzza", categories: { name: "Pizzas" } });
  });
  it("or() del cursor del tablero ejecutivo", async () => {
    db.raw.prepare("UPDATE orders SET created_at = '2026-11-10T00:00:00.000Z'").run();
    const r = await run({ table: "orders", columns: "id", filters: [{ op: "or", column: "", value: 'created_at.lt."2026-11-10T00:00:00.000Z",and(created_at.eq."2026-11-10T00:00:00.000Z",id.lt."o-beto")' }], order: [{ column: "id", ascending: true }] });
    assert.deepEqual((r.data as Record<string, unknown>[]).map((x) => x.id), ["o-ana-1", "o-ana-2"]);
  });
  it("single sin filas → PGRST116; maybeSingle → null", async () => {
    assert.equal((await run({ table: "orders", filters: [{ op: "eq", column: "id", value: "nada" }], single: "single" })).error?.code, "PGRST116");
    assert.equal((await run({ table: "orders", filters: [{ op: "eq", column: "id", value: "nada" }], single: "maybe" })).data, null);
  });
  it("head + count", async () => {
    const r = await run({ table: "orders", head: true, count: true, filters: [{ op: "eq", column: "client_id", value: "c-ana" }] });
    assert.deepEqual([r.data, r.count], [null, 2]);
  });
});

describe("escrituras", () => {
  it("insert genera id, convierte pesos y devuelve la fila", async () => {
    const r = await run({ table: "orders", action: "insert", returning: true, single: "single", payload: { client_id: "c-ana", items_desc: "1x Fugazza", total: 9900.5, delivery_fee: 500, delivered_in_app: true } });
    assert.equal(r.error, null);
    const o = r.data as Record<string, unknown>;
    assert.match(String(o.id), /^[0-9a-f-]{36}$/);
    assert.equal(o.total, 9900.5);
    assert.equal((db.raw.prepare("SELECT total_cents, delivered_in_app FROM orders WHERE id = ?").get(o.id as string) as Record<string, unknown>).total_cents, 990050);
  });
  it("update condicional (status) con returning, como el PATCH de pedidos", async () => {
    const ok = await run({ table: "orders", action: "update", payload: { status: "Finalizados" }, filters: [{ op: "eq", column: "id", value: "o-ana-2" }, { op: "eq", column: "status", value: "En Camino" }], returning: true, single: "maybe" });
    assert.equal((ok.data as Record<string, unknown>).status, "Finalizados");
    const again = await run({ table: "orders", action: "update", payload: { status: "Finalizados" }, filters: [{ op: "eq", column: "id", value: "o-ana-2" }, { op: "eq", column: "status", value: "En Camino" }], returning: true, single: "maybe" });
    assert.equal(again.data, null, "un doble clic no vuelve a aplicar");
  });
  it("upsert por clave compuesta y global_config JSON", async () => {
    await run({ table: "global_config", action: "upsert", onConflict: "key", payload: [{ key: "store", value: { open: false } }] });
    const r = await run({ table: "global_config", filters: [{ op: "eq", column: "key", value: "store" }], single: "single" });
    assert.deepEqual((r.data as Record<string, unknown>).value, { open: false });
    await run({ table: "courier_shifts", action: "upsert", onConflict: "user_id,shift_day", payload: { id: "00000000-0000-4000-8000-000000000001", user_id: "u-rep1", courier_name: "Rep Uno", shift_day: "2026-11-14" } });
    await run({ table: "courier_shifts", action: "upsert", onConflict: "user_id,shift_day", payload: { id: "00000000-0000-4000-8000-000000000002", user_id: "u-rep1", courier_name: "Rep Uno", shift_day: "2026-11-14" } });
    assert.equal((db.raw.prepare("SELECT count(*) n FROM courier_shifts").get() as { n: number }).n, 1);
  });
  it("delete con returning", async () => {
    const r = await run({ table: "reviews", action: "delete", filters: [{ op: "eq", column: "id", value: "r-beto" }], returning: true });
    assert.equal((r.data as unknown[]).length, 1);
  });
  it("errores con los códigos de Postgres que usa la app", async () => {
    const dup = await run({ table: "couriers", action: "insert", payload: { user_id: "u-rep2", name: "Otro", pin_hash: "hash-1" } });
    assert.equal(dup.error?.code, "23505");
    const fk = await run({ table: "orders", action: "insert", payload: { client_id: "no-existe", items_desc: "x" } });
    assert.equal(fk.error?.code, "23503");
  });
});

describe("seguridad del motor", () => {
  it("solo staff/sistema", async () => {
    for (const a of [actors.anon, actors.ana, actors.rep1]) {
      await assert.rejects(executeD1Plan(db, a, plan({ table: "orders" })), ForbiddenError);
    }
  });
  it("tablas fuera de la app y de Better Auth no existen para el cliente", async () => {
    for (const t of ["user", "session", "account", "recetas", "sqlite_master", "orders; DROP TABLE orders"]) {
      assert.equal((await run({ table: t })).error?.code, "42P01", t);
    }
  });
  it("columnas inyectadas o desconocidas se rechazan; los valores van ligados", async () => {
    const bad = await run({ table: "orders", filters: [{ op: "eq", column: 'id" = id OR 1=1 --', value: "x" }] });
    assert.equal(bad.error?.code, "42703");
    const evil = await run({ table: "orders", filters: [{ op: "eq", column: "id", value: "x' OR '1'='1" }] });
    assert.deepEqual(evil.data, []);
    const badOrder = await run({ table: "orders", order: [{ column: "total; DROP TABLE orders", ascending: true }] });
    assert.equal(badOrder.error?.code, "42703");
    const badOr = await run({ table: "orders", filters: [{ op: "or", column: "", value: "id.eq.x),1=1--" }] });
    assert.ok(badOr.error);
    assert.equal((db.raw.prepare("SELECT count(*) n FROM orders").get() as { n: number }).n, 4);
  });
  it("UPDATE y DELETE sin filtros se rechazan (como pg_safeupdate de PostgREST)", async () => {
    for (const table of ["orders", "clients", "points_ledger"]) {
      const upd = await run({ table, action: "update", payload: { description: "x", name: "x", status: "Cancelado" } });
      assert.equal(upd.error?.code, "21000", `update ${table}`);
      const del = await run({ table, action: "delete" });
      assert.equal(del.error?.code, "21000", `delete ${table}`);
    }
    assert.equal((db.raw.prepare("SELECT count(*) n FROM orders").get() as { n: number }).n, 4);
    assert.equal((db.raw.prepare("SELECT count(*) n FROM orders WHERE status = 'Cancelado'").get() as { n: number }).n, 0);
  });

  it("neq y not tienen la semántica de NULL de Postgres (excluyen NULL)", async () => {
    // courier_name: NULL en o-ana-1 y o-libre.
    const neq = await run({ table: "orders", columns: "id", filters: [{ op: "neq", column: "courier_name", value: "Rep Uno" }], order: [{ column: "id", ascending: true }] });
    assert.deepEqual((neq.data as Record<string, unknown>[]).map((x) => x.id), ["o-beto-1"]);
    const notEq = await run({ table: "orders", columns: "id", filters: [{ op: "not", column: "courier_name", value: { op: "eq", value: "Rep Uno" } }] });
    assert.deepEqual((notEq.data as Record<string, unknown>[]).map((x) => x.id), ["o-beto-1"]);
    const notIn = await run({ table: "orders", columns: "id", filters: [{ op: "not", column: "courier_name", value: { op: "in", value: ["Rep Uno"] } }] });
    assert.deepEqual((notIn.data as Record<string, unknown>[]).map((x) => x.id), ["o-beto-1"]);
    const notNull = await run({ table: "orders", columns: "id", filters: [{ op: "not", column: "courier_name", value: { op: "is", value: null } }], order: [{ column: "id", ascending: true }] });
    assert.deepEqual((notNull.data as Record<string, unknown>[]).map((x) => x.id), ["o-ana-2", "o-beto-1"]);
  });

  it("in() con más valores que el tope de D1 da un error claro; los embebidos van en lotes", async () => {
    const big = Array.from({ length: 150 }, (_, i) => `x-${i}`);
    assert.equal((await run({ table: "orders", filters: [{ op: "in", column: "id", value: big }] })).error?.code, "54000");
    const ins = db.raw.prepare("INSERT INTO order_items (id, order_id, name, qty, unit_price_cents) VALUES (?, 'o-ana-2', 'x', 1, 100)");
    for (let i = 0; i < 120; i++) ins.run(`it-${i}`);
    for (let i = 0; i < 110; i++) db.raw.prepare("INSERT INTO orders (id, client_id, items_desc) VALUES (?, 'c-ana', 'x')").run(`o-x-${i}`);
    const r = await run({ table: "orders", columns: "id, order_items(id)" });
    assert.equal(r.error, null);
    assert.equal((r.data as Record<string, unknown>[]).length, 114);
  });

  it("integration_secrets: leer devuelve vacío (manda el entorno) y escribir falla", async () => {
    assert.deepEqual((await run({ table: "integration_secrets", columns: "key, value" })).data, []);
    assert.equal((await run({ table: "integration_secrets", action: "upsert", payload: { key: "k", value: "v" } })).error?.code, "D5");
  });
});
