/** F4: el cliente ve su saldo a favor y sus últimos movimientos (solo los suyos, sin descripción interna). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as cv from "../src/lib/data/client-views.ts";
import { creditMovementLabel, toCreditMovements } from "../src/lib/credit-view.ts";

function setup() {
  const db = createTestDb();
  seed(db);
  const ins = db.raw.prepare(
    "INSERT INTO credit_ledger (id, client_id, order_id, delta_cents, motivo, description, idempotency_key, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  ins.run("cl-1", "c-ana", null, 500000, "reclamo", "Reclamo de Beto: dato interno", "k1", "2026-11-20T10:00:00.000Z");
  ins.run("cl-2", "c-ana", "o-ana-1", -200000, "compra", "nota interna", "k2", "2026-11-21T10:00:00.000Z");
  ins.run("cl-3", "c-beto", null, 900000, "ajuste", "de Beto", "k3", "2026-11-22T10:00:00.000Z");
  return db;
}

describe("listOwnCreditLedger", () => {
  it("devuelve solo los movimientos del cliente autenticado, del más nuevo al más viejo", async () => {
    const rows = await cv.listOwnCreditLedger(setup(), actors.ana, 10);
    assert.deepEqual(rows.map((r) => r.id), ["cl-2", "cl-1"]);
  });

  it("no expone description ni ids de otros: solo motivo, monto en pesos, fecha y pedido", async () => {
    const [first] = await cv.listOwnCreditLedger(setup(), actors.ana, 10);
    assert.deepEqual(Object.keys(first).sort(), ["created_at", "delta", "id", "motivo", "order_id"]);
    assert.equal(first.delta, -2000);
  });

  it("respeta el límite", async () => {
    assert.equal((await cv.listOwnCreditLedger(setup(), actors.ana, 1)).length, 1);
  });

  it("rechaza actores que no son cliente", async () => {
    await assert.rejects(cv.listOwnCreditLedger(setup(), actors.admin, 10), ForbiddenError);
    await assert.rejects(cv.listOwnCreditLedger(setup(), actors.anon, 10), ForbiddenError);
  });
});

describe("creditMovementLabel", () => {
  it("motivos legibles", () => {
    assert.equal(creditMovementLabel("reclamo", null), "Reclamo resuelto");
    assert.equal(creditMovementLabel("devolucion", "abcdef1234"), "Devolución");
    assert.equal(creditMovementLabel("ajuste", null), "Ajuste");
  });
  it("compra con pedido muestra el número corto; sin pedido, texto genérico", () => {
    assert.equal(creditMovementLabel("compra", "abcdef12-3456"), "Usado en pedido #ABCDEF12");
    assert.equal(creditMovementLabel("compra", null), "Usado en un pedido");
  });
  it("motivo desconocido no rompe", () => {
    assert.equal(creditMovementLabel("otro", null), "Movimiento");
  });
});

describe("toCreditMovements", () => {
  it("arma etiqueta y signo", () => {
    const [m] = toCreditMovements([{ id: "1", delta: -2000, motivo: "compra", order_id: "abcdef12-3", created_at: "2026-11-21T10:00:00.000Z" }]);
    assert.equal(m.label, "Usado en pedido #ABCDEF12");
    assert.equal(m.negative, true);
    assert.equal(m.amountText, "−$2.000");
    const [p] = toCreditMovements([{ id: "2", delta: 5000, motivo: "reclamo", order_id: null, created_at: "x" }]);
    assert.equal(p.amountText, "+$5.000");
    assert.equal(p.negative, false);
  });
});
