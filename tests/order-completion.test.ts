import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { completedAt, preparedAt, finishedStats, MAX_PLAUSIBLE_MINUTES } = await import("../src/lib/reports/completion.ts");

const CREATED = "2026-11-06T20:00:00.000Z";
const plus = (min: number) => new Date(Date.parse(CREATED) + min * 60_000).toISOString();
const base = { status: "Finalizados", created_at: CREATED, ready_at: null, delivered_at: null, updated_at: null, fudo_sale_type: null };

describe("completedAt", () => {
  it("prefiere delivered_at", () => {
    assert.equal(completedAt({ ...base, delivered_at: plus(30), updated_at: plus(90) }), plus(30));
  });
  it("sin delivered_at usa updated_at si es creíble", () => {
    assert.equal(completedAt({ ...base, updated_at: plus(35) }), plus(35));
  });
  it("descarta updated_at de una sincronización masiva", () => {
    assert.equal(completedAt({ ...base, updated_at: plus(MAX_PLAUSIBLE_MINUTES + 1) }), null);
  });
  it("un pedido en curso no terminó", () => {
    assert.equal(completedAt({ ...base, status: "En Camino", updated_at: plus(5) }), null);
  });
  it("rechaza fechas invertidas", () => {
    assert.equal(completedAt({ ...base, updated_at: plus(-5) }), null);
  });
});

describe("preparedAt", () => {
  it("usa ready_at si existe", () => {
    assert.equal(preparedAt({ ...base, ready_at: plus(12), delivered_at: plus(30) }), plus(12));
  });
  it("en take away el cierre es el fin de la preparación", () => {
    assert.equal(preparedAt({ ...base, fudo_sale_type: "TAKEAWAY", updated_at: plus(6) }), plus(6));
  });
  it("en delivery sin ready_at no se puede separar del viaje", () => {
    assert.equal(preparedAt({ ...base, fudo_sale_type: "DELIVERY", updated_at: plus(35) }), null);
  });
});

describe("finishedStats", () => {
  it("promedia y da el porcentaje dentro del objetivo, ignorando los no medibles", () => {
    const orders = [
      { ...base, delivered_at: plus(20) },
      { ...base, delivered_at: plus(40) },
      { ...base, updated_at: plus(30_000) },
    ];
    assert.deepEqual(finishedStats(orders, 30), { avgMinutes: 30, onTargetPct: 50, measured: 2 });
  });
  it("sin medibles devuelve null, no cero", () => {
    assert.deepEqual(finishedStats([], 30), { avgMinutes: null, onTargetPct: null, measured: 0 });
  });
});
