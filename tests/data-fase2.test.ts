/**
 * Fase 2: escritura doble / lectura sombra, matriz de estados de pedidos,
 * equivalentes de G16/G17 (cliente anónimo de Fudo) y actorFromSession.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { shadowRead, dualWrite, compareRows, assertIdKey, type DiffLogger } from "../src/lib/data/shadow.ts";
import { actorFromSession, ForbiddenError } from "../src/lib/data/actor.ts";
import * as orders from "../src/lib/data/orders.ts";
import * as fudo from "../src/lib/data/fudo.ts";
import * as catalog from "../src/lib/data/catalog.ts";
import { NEXT_STATUSES } from "../src/lib/orders.ts";

function capture() {
  const events: Parameters<DiffLogger>[0][] = [];
  return { events, log: ((e) => events.push(e)) as DiffLogger };
}
const opts = { op: "t", normalize: (r: Record<string, unknown>) => r, normalizeShadow: (r: Record<string, unknown>) => r, key: (r: Record<string, unknown>) => String(r.id) };

describe("shadowRead", () => {
  it("supabase: no invoca D1", async () => {
    let called = false;
    const r = await shadowRead(async () => [{ id: 1 }], async () => ((called = true), []), { ...opts, backend: "supabase" });
    assert.deepEqual(r, [{ id: 1 }]);
    assert.equal(called, false);
  });
  it("dual: devuelve Supabase y registra diferencias sin valores", async () => {
    const { events, log } = capture();
    const r = await shadowRead(
      async () => [{ id: "a", name: "Ana Pérez", phone: "1155554444" }, { id: "b", name: "x" }],
      async () => [{ id: "a", name: "Ana P", phone: "1155554444" }, { id: "c", name: "y" }],
      { ...opts, backend: "dual", log },
    );
    assert.equal(r.length, 2);
    assert.equal(events.length, 1);
    const text = JSON.stringify(events[0]);
    for (const pii of ["Ana", "1155554444", '"a"', '"b"', '"c"']) assert.ok(!text.includes(pii), `sin PII: ${pii}`);
    const e = events[0] as { kind: string; diff: { missingInShadow: string[]; extraInShadow: string[]; fieldDiffs: Record<string, string[]> } };
    assert.equal(e.kind, "shadow_diff");
    assert.equal(e.diff.missingInShadow.length, 1);
    assert.equal(e.diff.extraInShadow.length, 1);
    assert.deepEqual(Object.values(e.diff.fieldDiffs), [["name"]]);
  });
  it("dual: si D1 falla, responde igual y registra solo el tipo de error", async () => {
    const { events, log } = capture();
    const r = await shadowRead(async () => [{ id: 1 }], async () => { throw new Error("UNIQUE constraint failed: clients.phone = 1155554444"); }, { ...opts, backend: "dual", log });
    assert.deepEqual(r, [{ id: 1 }]);
    assert.equal(JSON.stringify(events), JSON.stringify([{ kind: "shadow_error", op: "t", error: "Error:UNIQUE" }]));
  });
  it("dual: si Supabase falla, el error se propaga", async () => {
    await assert.rejects(shadowRead(async () => { throw new Error("x"); }, async () => [], { ...opts, backend: "dual" }));
  });
  it("d1: solo D1", async () => {
    const r = await shadowRead(async () => { throw new Error("no"); }, async () => [{ id: 9 }], { ...opts, backend: "d1" });
    assert.deepEqual(r, [{ id: 9 }]);
  });
  it("sin diferencias no registra nada; JSON con otro orden de claves es igual", async () => {
    assert.equal(await compareRows("t", [{ id: "k1", v: { a: 1, b: 2 }, ok: true }], [{ id: "k1", v: { b: 2, a: 1 }, ok: 1 }], (r) => String(r.id)), null);
  });
});

describe("clave de comparación solo ids", () => {
  it("acepta uuid y claves de config; rechaza teléfonos, emails y números de Fudo", async () => {
    assert.equal(assertIdKey("8e293f66-d614-4519-8514-be4dd6a3ac44"), "8e293f66-d614-4519-8514-be4dd6a3ac44");
    assert.equal(assertIdKey("promos_del_dia"), "promos_del_dia");
    for (const bad of ["1155554444", "+5491155554444", "ana@x.test", "123456"]) assert.throws(() => assertIdKey(bad));
    await assert.rejects(compareRows("t", [{ id: "ana@x.test" }], [], (r) => String(r.id)));
  });
});

describe("dualWrite", () => {
  it("supabase: no escribe en D1", async () => {
    let mirrored = false;
    await dualWrite("t", async () => 1, async () => { mirrored = true; }, { backend: "supabase" });
    assert.equal(mirrored, false);
  });
  it("dual: Supabase primero, D1 después; fallo de D1 no rompe", async () => {
    const order: string[] = [];
    const { events, log } = capture();
    const r = await dualWrite("t", async () => (order.push("p"), 7), async () => { order.push("m"); throw new Error("boom"); }, { backend: "dual", log });
    assert.equal(r, 7);
    assert.deepEqual(order, ["p", "m"]);
    assert.equal((events[0] as { kind: string }).kind, "mirror_error");
  });
  it("dual: si Supabase falla, no se escribe en D1", async () => {
    let mirrored = false;
    await assert.rejects(dualWrite("t", async () => { throw new Error("x"); }, async () => { mirrored = true; }, { backend: "dual" }));
    assert.equal(mirrored, false);
  });
});

describe("matriz de estados de pedidos", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => { db = createTestDb(); seed(db); });

  it("es la misma que NEXT_STATUSES de la app", () => {
    assert.deepEqual(orders.STAFF_TRANSITIONS, NEXT_STATUSES);
  });
  it("el admin no salta estados ni sale de un final", async () => {
    await assert.rejects(orders.setOrderStatus(db, actors.admin, "o-libre", "Finalizados"), orders.InvalidTransitionError);
    await assert.rejects(orders.setOrderStatus(db, actors.admin, "o-ana-1", "Recibidos"), orders.InvalidTransitionError);
    assert.equal(await orders.setOrderStatus(db, actors.admin, "o-libre", "En Camino"), true);
  });
  it("el sistema (Fudo) puede avanzar salteando, nunca retroceder", async () => {
    db.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc) VALUES ('o-new', 'c-ana', 'Recibidos', 'x')").run();
    assert.equal(await orders.setOrderStatus(db, actors.system, "o-new", "Finalizados"), true);
    await assert.rejects(orders.setOrderStatus(db, actors.system, "o-new", "En Camino"), orders.InvalidTransitionError);
  });
  it("pedido inexistente devuelve false", async () => {
    assert.equal(await orders.setOrderStatus(db, actors.admin, "nada", "Cancelado"), false);
  });
});

describe("G16/G17 cliente anónimo de Fudo", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => { db = createTestDb(); seed(db); });

  it("mismo nombre y canal → mismo cliente (sin importar mayúsculas)", async () => {
    const a = await fudo.resolveAnonymousClient(db, actors.system, { name: "juan perez", channel: "rappi", newId: "x1" });
    const b = await fudo.resolveAnonymousClient(db, actors.system, { name: "JUAN PEREZ", channel: "rappi", newId: "x2" });
    assert.equal(a, b);
    const c = await fudo.resolveAnonymousClient(db, actors.system, { name: "juan perez", channel: "pedidosya", newId: "x3" });
    assert.notEqual(a, c);
    assert.equal((db.raw.prepare("SELECT name FROM clients WHERE id = ?").get(a) as { name: string }).name, "Juan Perez");
  });
  it("sin nombre se agrupa por tipo de venta; canal desconocido → local", async () => {
    assert.equal(fudo.anonymousClientName("", "TAKEAWAY"), "Sin Nombre · Take Away");
    const id = await fudo.resolveAnonymousClient(db, actors.system, { name: null, channel: "otro", saleType: "DELIVERY", newId: "x4" });
    assert.equal((db.raw.prepare("SELECT channel FROM clients WHERE id = ?").get(id) as { channel: string }).channel, "local");
  });
  it("vincula solo pedidos de Fudo sin cliente", async () => {
    assert.equal(await fudo.linkFudoOrderClient(db, actors.system, { channel: "web", client_id: null }, "y1"), null);
    assert.equal(await fudo.linkFudoOrderClient(db, actors.system, { channel: "fudo", client_id: "c-ana" }, "y2"), "c-ana");
    assert.ok(await fudo.linkFudoOrderClient(db, actors.system, { channel: "fudo", client_id: null, customer_name: "Lu", fudo_source: "morfy" }, "y3"));
  });
  it("nunca expuesto a clientes ni repartidores (G16)", async () => {
    for (const a of [actors.anon, actors.ana, actors.rep1]) {
      await assert.rejects(fudo.resolveAnonymousClient(db, a, { name: "x", newId: "z" }), ForbiddenError);
    }
  });
});

describe("config en D1 (tanda 1)", () => {
  it("listConfig/setConfigMany solo staff y en batch", async () => {
    const db = createTestDb();
    seed(db);
    await assert.rejects(catalog.listConfig(db, actors.ana), ForbiddenError);
    await assert.rejects(catalog.setConfigMany(db, actors.ana, [{ key: "k", value: 1 }]), ForbiddenError);
    await catalog.setConfigMany(db, actors.admin, [{ key: "a", value: { x: 1 } }, { key: "store", value: { open: false } }]);
    const rows = await catalog.listConfig(db, actors.admin);
    assert.deepEqual(rows, [{ key: "a", value: { x: 1 } }, { key: "store", value: { open: false } }]);
  });
});

describe("actorFromSession", () => {
  it("rol desconocido o sin usuario → anon", () => {
    assert.deepEqual(actorFromSession({ userId: "u", role: "superadmin" }), { kind: "anon" });
    assert.deepEqual(actorFromSession({ userId: "", role: "admin" }), { kind: "anon" });
    assert.deepEqual(actorFromSession({ userId: "u", role: "admin" }), { kind: "admin", userId: "u" });
  });
});
