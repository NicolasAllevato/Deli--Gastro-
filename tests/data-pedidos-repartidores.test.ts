/**
 * Fase 2, tanda pedidos y repartidores: espejo D1 de lo que la app escribe en
 * Supabase (pedidos, bitácora, repartidores, habilitaciones, ubicación) y login
 * por PIN en D1 con migración del hash a la clave actual.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as mirror from "../src/lib/data/mirror.ts";
import * as couriers from "../src/lib/data/couriers.ts";
import { mirrorToD1, type DiffLogger } from "../src/lib/data/shadow.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

const ORDER_ID = "00000000-0000-4000-8000-000000000101";
const supaOrder = (over: Record<string, unknown> = {}) => ({
  id: ORDER_ID, client_id: "c-ana", status: "En Camino", items_desc: "1x Muzza", total: "12500.50", delivery_fee: 800,
  delivery_address: "Calle 1", delivery_lat: -34.6, delivery_lng: -58.4, payment_method: "Efectivo", notes: null,
  courier_name: "Rep Uno", channel: "web", points_earned: null, created_at: "2026-11-13T18:23:27.000Z",
  updated_at: "2026-11-13T18:30:00.000Z", accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null,
  survey_sent_at: null, fudo_order_id: null, fudo_sync_status: null, fudo_sale_type: null, fudo_sale_state: null,
  fudo_error: null, fudo_attempts: 0, fudo_synced_at: null, delivered_lat: null, delivered_lng: null,
  delivered_accuracy_m: null, delivered_in_app: false, geocode_attempts: 0, fudo_payments: [{ id: 1, amount: 100 }],
  ...over,
});

describe("espejo de pedidos", () => {
  it("copia la fila de Supabase: centavos, booleanos y JSON", async () => {
    await mirror.mirrorOrderRow(db, actors.system, supaOrder());
    const r = db.raw.prepare("SELECT * FROM orders WHERE id = ?").get(ORDER_ID) as Record<string, unknown>;
    assert.equal(r.total_cents, 1250050);
    assert.equal(r.delivery_fee_cents, 80000);
    assert.equal(r.delivered_in_app, 0);
    assert.deepEqual(JSON.parse(String(r.fudo_payments)), [{ id: 1, amount: 100 }]);
    assert.equal(r.courier_user_id, "u-rep1", "dueño derivado del nombre (único)");
  });
  it("re-copiar actualiza (idempotente) y sin repartidor limpia el dueño", async () => {
    await mirror.mirrorOrderRow(db, actors.system, supaOrder());
    await mirror.mirrorOrderRow(db, actors.system, supaOrder({ status: "Finalizados", courier_name: null, delivered_in_app: true }));
    const r = db.raw.prepare("SELECT status, courier_user_id, delivered_in_app FROM orders WHERE id = ?").get(ORDER_ID) as Record<string, unknown>;
    assert.deepEqual({ ...r }, { status: "Finalizados", courier_user_id: null, delivered_in_app: 1 });
    assert.equal((db.raw.prepare("SELECT count(*) n FROM orders WHERE id = ?").get(ORDER_ID) as { n: number }).n, 1);
  });
  it("nombre de repartidor ambiguo no asigna dueño", async () => {
    db.raw.prepare("INSERT INTO couriers (user_id, name, pin_hash) VALUES ('u-rep2', 'Rep Uno', 'h2')").run();
    await mirror.mirrorOrderRow(db, actors.system, supaOrder());
    const r = db.raw.prepare("SELECT courier_user_id FROM orders WHERE id = ?").get(ORDER_ID) as { courier_user_id: string | null };
    assert.equal(r.courier_user_id, null);
  });
  it("bitácora idempotente por id", async () => {
    await mirror.mirrorOrderRow(db, actors.system, supaOrder());
    const ev = { id: "00000000-0000-4000-8000-000000000201", order_id: ORDER_ID, event: "En Camino", actor: "admin", detail: null, created_at: "2026-11-13T18:31:00.000Z" };
    await mirror.mirrorOrderEvents(db, actors.system, [ev]);
    await mirror.mirrorOrderEvents(db, actors.system, [ev]);
    assert.equal((db.raw.prepare("SELECT count(*) n FROM order_events WHERE order_id = ?").get(ORDER_ID) as { n: number }).n, 1);
  });
  it("cubre las 37 columnas de Supabase", () => {
    assert.equal(mirror.ORDER_MIRROR_COLUMNS.length, 37);
    assert.ok(!mirror.ORDER_MIRROR_COLUMNS.includes("courier_user_id"));
  });
});

describe("espejo de repartidores, habilitaciones y ubicación", () => {
  it("repartidor con pin_hash y pin_encrypted; habilitación y ubicación", async () => {
    db.raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES ('u-rep9','r9@x','repartidor','x','x')`).run();
    await mirror.mirrorCourierRow(db, actors.system, { user_id: "u-rep9", name: "Rep Nueve", pin_hash: "hh", active: true, pin_encrypted: "enc", created_at: "x", updated_at: "x" });
    await mirror.mirrorCourierRow(db, actors.system, { user_id: "u-rep9", name: "Rep 9", pin_hash: "hh2", active: false, pin_encrypted: null, created_at: "x", updated_at: "y" });
    const c = db.raw.prepare("SELECT name, pin_hash, active, pin_encrypted FROM couriers WHERE user_id = 'u-rep9'").get() as Record<string, unknown>;
    assert.deepEqual({ ...c }, { name: "Rep 9", pin_hash: "hh2", active: 0, pin_encrypted: null });

    const shift = { id: "00000000-0000-4000-8000-000000000301", user_id: "u-rep9", courier_name: "Rep 9", shift_day: "2026-11-13", status: "pending", requested_at: "x", decided_at: null };
    await mirror.mirrorShiftRow(db, actors.system, shift);
    await mirror.mirrorShiftRow(db, actors.system, { ...shift, status: "approved", decided_at: "y" });
    assert.equal((db.raw.prepare("SELECT status FROM courier_shifts WHERE id = ?").get(shift.id) as { status: string }).status, "approved");

    await mirror.mirrorLocationRow(db, actors.system, { user_id: "u-rep9", courier_name: "Rep 9", lat: -34.6, lng: -58.4, accuracy_m: 5, heading: null, speed_mps: null, updated_at: "z" });
    assert.equal((db.raw.prepare("SELECT count(*) n FROM courier_locations").get() as { n: number }).n, 1);
    await mirror.mirrorLocationDelete(db, actors.system, "u-rep9");
    assert.equal((db.raw.prepare("SELECT count(*) n FROM courier_locations").get() as { n: number }).n, 0);
  });
  it("solo el servidor puede espejar", async () => {
    for (const a of [actors.anon, actors.ana, actors.rep1]) {
      await assert.rejects(mirror.mirrorOrderRow(db, a, supaOrder()), ForbiddenError);
      await assert.rejects(mirror.mirrorCourierRow(db, a, { user_id: "u-rep1", name: "x", pin_hash: "y" }), ForbiddenError);
      await assert.rejects(mirror.mirrorShiftRow(db, a, {}), ForbiddenError);
      await assert.rejects(mirror.mirrorLocationDelete(db, a, "u-rep1"), ForbiddenError);
    }
  });
});

describe("upsertStatement", () => {
  it("una fila con solo la clave no genera SQL inválido (DO NOTHING)", async () => {
    await mirror.upsertStatement(db, "courier_locations", ["user_id"], ["user_id"], ["u-rep1"]).run().catch((e: Error) => {
      // Falla por NOT NULL de otras columnas, nunca por sintaxis.
      assert.doesNotMatch(e.message, /syntax/i);
    });
    const sql = (mirror.upsertStatement(db, "couriers", ["user_id"], ["user_id"], ["u-rep1"]) as unknown as { sql: string }).sql;
    assert.match(sql, /ON CONFLICT \(user_id\) DO NOTHING$/);
  });
});

describe("mirrorToD1", () => {
  it("supabase: no escribe; dual: escribe y un fallo no rompe", async () => {
    let wrote = false;
    await mirrorToD1("t", async () => { wrote = true; }, { backend: "supabase" });
    assert.equal(wrote, false);
    const events: Parameters<DiffLogger>[0][] = [];
    await mirrorToD1("t", async () => { throw new Error("FOREIGN KEY constraint failed"); }, { backend: "dual", log: (e) => events.push(e) });
    assert.deepEqual(events, [{ kind: "mirror_error", op: "t", error: "Error:FOREIGN KEY" }]);
  });
});

describe("login por PIN en D1 con migración de clave", () => {
  it("entra con el hash viejo, lo migra y después entra con el nuevo", async () => {
    db.raw.prepare("UPDATE couriers SET pin_hash = 'viejo' WHERE user_id = 'u-rep1'").run();
    assert.equal((await couriers.findCourierByPinHashes(db, actors.system, ["nuevo", "viejo"]))?.user_id, "u-rep1");
    assert.equal((db.raw.prepare("SELECT pin_hash FROM couriers WHERE user_id = 'u-rep1'").get() as { pin_hash: string }).pin_hash, "nuevo");
    assert.equal((await couriers.findCourierByPinHashes(db, actors.system, ["nuevo", "viejo"]))?.user_id, "u-rep1");
    assert.equal(await couriers.findCourierByPinHashes(db, actors.system, ["otro"]), null);
  });
  it("inactivo no entra; solo el servidor", async () => {
    db.raw.prepare("UPDATE couriers SET active = 0 WHERE user_id = 'u-rep1'").run();
    assert.equal(await couriers.findCourierByPinHashes(db, actors.system, ["hash-1"]), null);
    await assert.rejects(couriers.findCourierByPinHashes(db, actors.rep1, ["hash-1"]), ForbiddenError);
  });
});
