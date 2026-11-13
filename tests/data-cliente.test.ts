/**
 * Fase 2, tanda 3: lecturas del portal cliente en D1. Cada cliente ve solo
 * lo suyo (orders_select_own, reviews_select_own, ledger_select_own).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as cv from "../src/lib/data/client-views.ts";
import { compareRows } from "../src/lib/data/shadow.ts";

const plain = <T>(rows: T[]): T[] => rows.map((r) => ({ ...r }));
let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
  db.raw.prepare("INSERT INTO reviews (id, order_id, client_id, rating) VALUES ('r-ana', 'o-ana-1', 'c-ana', 5)").run();
  db.raw.prepare("INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES ('l-ana-o1', 'c-ana', 'o-ana-1', 30, 'pedido')").run();
  db.raw.prepare("INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES ('l-ana-o1b', 'c-ana', 'o-ana-1', 5, 'bonus')").run();
  db.raw.prepare("INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES ('l-ana-canje', 'c-ana', 'o-ana-1', -20, 'canje')").run();
  db.raw.prepare("INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES ('l-beto-o1', 'c-beto', 'o-beto-1', 70, 'pedido')").run();
});

describe("solo el cliente accede a las vistas del cliente", () => {
  it("anon, repartidor, admin y sistema no usan estas funciones", async () => {
    for (const a of [actors.anon, actors.rep1, actors.admin, actors.system]) {
      await assert.rejects(cv.listOwnOrders(db, a), ForbiddenError);
      await assert.rejects(cv.getOwnOrder(db, a, "o-ana-1"), ForbiddenError);
      await assert.rejects(cv.listOwnReviewedOrderIds(db, a), ForbiddenError);
      await assert.rejects(cv.listOwnLedger(db, a), ForbiddenError);
      await assert.rejects(cv.listOwnEarnedByOrder(db, a), ForbiddenError);
    }
  });
});

describe("G4 pedidos propios", () => {
  it("lista solo los suyos, montos en pesos", async () => {
    const ana = await cv.listOwnOrders(db, actors.ana);
    assert.deepEqual(ana.map((o) => o.id).sort(), ["o-ana-1", "o-ana-2"]);
    assert.equal(ana.find((o) => o.id === "o-ana-1")?.total, 12500.5);
    const beto = await cv.listOwnOrders(db, actors.beto);
    assert.ok(beto.every((o) => o.id.startsWith("o-beto") || o.id === "o-libre"));
  });
  it("no ve un pedido ajeno por id (IDOR)", async () => {
    assert.equal(await cv.getOwnOrder(db, actors.ana, "o-beto-1"), null);
    assert.equal((await cv.getOwnOrder(db, actors.ana, "o-ana-2"))?.id, "o-ana-2");
  });
  it("la vista no expone columnas internas", async () => {
    const [o] = await cv.listOwnOrders(db, actors.ana);
    for (const k of ["client_id", "courier_user_id", "fudo_error", "fudo_payments", "delivered_lat", "payment_intent_id", "geocode_attempts"]) {
      assert.ok(!(k in o), `no expone ${k}`);
    }
  });
  it("un usuario sin fila de cliente no ve nada", async () => {
    assert.deepEqual(await cv.listOwnOrders(db, { kind: "cliente", userId: "u-admin" }), []);
  });
});

describe("G7 reseñas propias", () => {
  it("solo ids de sus pedidos reseñados", async () => {
    assert.deepEqual(plain(await cv.listOwnReviewedOrderIds(db, actors.ana)), [{ id: "o-ana-1" }]);
    assert.deepEqual(plain(await cv.listOwnReviewedOrderIds(db, actors.beto)), [{ id: "o-beto-1" }]);
  });
});

describe("G6 puntos propios", () => {
  it("historial solo propio, con límite", async () => {
    const ana = await cv.listOwnLedger(db, actors.ana, 100);
    assert.ok(ana.length > 0 && ana.every((l) => !l.id.includes("beto")));
    assert.equal((await cv.listOwnLedger(db, actors.ana, 1)).length, 1);
  });
  it("acreditados por pedido: suma solo positivos", async () => {
    assert.deepEqual(plain(await cv.listOwnEarnedByOrder(db, actors.ana)), [{ id: "o-ana-1", delta: 35 }]);
    assert.deepEqual(plain(await cv.listOwnEarnedByOrder(db, actors.beto)), [{ id: "o-beto-1", delta: 70 }]);
  });
});

describe("comparación Supabase vs D1", () => {
  it("el mismo pedido en pesos (Supabase, todas las columnas) y en D1 no difiere", async () => {
    const d1 = await cv.getOwnOrder(db, actors.ana, "o-ana-1");
    assert.ok(d1);
    const supa = { ...d1, total: "12500.50", delivery_fee: "0", client_id: "c-ana", fudo_error: null, created_at: "otro" };
    assert.equal(
      await compareRows("t", [cv.comparableClientOrder(supa)], [cv.comparableClientOrder(d1 as never)], (r) => String(r.id)),
      null,
    );
  });
});
