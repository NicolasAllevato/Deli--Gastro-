/**
 * D1 como única fuente: escrituras de aceptación legal, perfil del cliente,
 * cancelación de pagos propios y reseñas, con su autorización por actor.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as legal from "../src/lib/data/legal.ts";
import * as clients from "../src/lib/data/clients.ts";
import * as payments from "../src/lib/data/payments.ts";
import * as reviews from "../src/lib/data/reviews.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});
const one = (sql: string, ...p: string[]) => ({ ...(db.raw.prepare(sql).get(...p) as Record<string, unknown>) });

const acc = (id: string, document: "terminos" | "privacidad" = "terminos") => ({
  id, document, version: "2026-10", email: "ana@x.test", role: "cliente", ip: "1.2.3.4", userAgent: "ua",
});

describe("aceptaciones legales", () => {
  it("el usuario de la sesión registra la suya; repetir no duplica", async () => {
    assert.equal(await legal.acceptOwn(db, actors.ana, acc("la-1")), true);
    assert.equal(await legal.acceptOwn(db, actors.ana, acc("la-2")), false);
    assert.equal(one("SELECT COUNT(*) n FROM legal_acceptances WHERE user_id = 'u-ana'").n, 1);
    const rows = await legal.listOwn(db, actors.ana);
    assert.deepEqual(rows.map((r) => [r.document, r.version]), [["terminos", "2026-10"]]);
  });
  it("cada uno ve solo las suyas; repartidor y admin también aceptan", async () => {
    await legal.acceptOwn(db, actors.ana, acc("la-1"));
    assert.equal((await legal.listOwn(db, actors.beto)).length, 0);
    assert.equal(await legal.acceptOwn(db, actors.rep1, acc("la-3", "privacidad")), true);
    assert.equal(await legal.acceptOwn(db, actors.admin, acc("la-4")), true);
  });
  it("anon y sistema no aceptan ni leen", async () => {
    for (const a of [actors.anon, actors.system]) {
      await assert.rejects(legal.acceptOwn(db, a, acc("la-x")), ForbiddenError);
      await assert.rejects(legal.listOwn(db, a), ForbiddenError);
    }
  });
});

describe("perfil del cliente", () => {
  it("devuelve su ficha y la cantidad de pedidos", async () => {
    const p = await clients.getOwnProfile(db, actors.ana);
    assert.equal(p?.client.id, "c-ana");
    assert.equal(p?.ordersTotal, 2);
  });
  it("solo clientes", async () => {
    for (const a of [actors.anon, actors.rep1, actors.admin, actors.system]) {
      await assert.rejects(clients.getOwnProfile(db, a), ForbiddenError);
    }
  });
});

describe("cancelación de pago propio", () => {
  it("el dueño cancela un pago pendiente una sola vez y sube la versión", async () => {
    assert.equal(await payments.cancelOwnPaymentIntent(db, actors.ana, "pi-ana"), true);
    assert.equal(await payments.cancelOwnPaymentIntent(db, actors.ana, "pi-ana"), false);
    assert.deepEqual(one("SELECT status, version FROM payment_intents WHERE id = 'pi-ana'"), { status: "cancelled", version: 1 });
  });
  it("otro cliente no puede cancelar el pago ajeno", async () => {
    assert.equal(await payments.cancelOwnPaymentIntent(db, actors.beto, "pi-ana"), false);
    assert.equal(one("SELECT status FROM payment_intents WHERE id = 'pi-ana'").status, "pending");
  });
  it("anon, repartidor y sistema no usan esta función", async () => {
    for (const a of [actors.anon, actors.rep1, actors.system, actors.admin]) {
      await assert.rejects(payments.cancelOwnPaymentIntent(db, a, "pi-ana"), ForbiddenError);
    }
  });
});

describe("reseñas", () => {
  it("motivo del rechazo: ajeno, no entregado, ya reseñado", async () => {
    assert.equal(await reviews.reviewEligibility(db, actors.beto, "o-ana-1"), "forbidden");
    assert.equal(await reviews.reviewEligibility(db, actors.ana, "o-ana-2"), "not_delivered");
    assert.equal(await reviews.reviewEligibility(db, actors.ana, "o-ana-1"), "ok");
    assert.equal(await reviews.createOwnReview(db, actors.ana, { id: "r-1", orderId: "o-ana-1", rating: 5 }), true);
    assert.equal(await reviews.reviewEligibility(db, actors.ana, "o-ana-1"), "already_reviewed");
  });
  it("solo clientes consultan la elegibilidad", async () => {
    for (const a of [actors.anon, actors.rep1, actors.admin, actors.system]) {
      await assert.rejects(reviews.reviewEligibility(db, a, "o-ana-1"), ForbiddenError);
    }
  });
});
