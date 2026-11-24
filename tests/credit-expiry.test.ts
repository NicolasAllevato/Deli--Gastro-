/** Vencimiento del saldo a favor: imputación FIFO de consumos a las acreditaciones más viejas (módulo puro). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { planExpirations, lotsOf, vencidoKey, expiryFrom } = await import("../src/lib/credit-expiry.ts");

type Row = { id: string; delta_cents: number; motivo: string; idempotency_key: string; created_at: string; expires_at: string | null };
let seq = 0;
const at = (day: number, h = 12) => `2026-01-${String(day).padStart(2, "0")}T${String(h).padStart(2, "0")}:00:00.000Z`;
const credit = (id: string, cents: number, day: number, expDay: number | null): Row => ({
  id, delta_cents: cents, motivo: "reclamo", idempotency_key: `k${++seq}`, created_at: at(day), expires_at: expDay === null ? null : at(expDay),
});
const spend = (cents: number, day: number, h = 12): Row => ({
  id: `s${++seq}`, delta_cents: -cents, motivo: "compra", idempotency_key: `k${++seq}`, created_at: at(day, h), expires_at: null,
});
const vencido = (lotId: string, cents: number, day: number): Row => ({
  id: `v${++seq}`, delta_cents: -cents, motivo: "vencido", idempotency_key: vencidoKey(lotId), created_at: at(day), expires_at: null,
});
const NOW = at(20);

describe("expiryFrom", () => {
  it("suma días al instante de la acreditación; 0 o inválido = no vence", () => {
    assert.equal(expiryFrom("2026-01-01T10:00:00.000Z", 30), "2026-01-31T10:00:00.000Z");
    assert.equal(expiryFrom("2026-01-01T10:00:00.000Z", 0), null);
    assert.equal(expiryFrom("2026-01-01T10:00:00.000Z", -5), null);
    assert.equal(expiryFrom("basura", 30), null);
  });
});

describe("planExpirations", () => {
  it("sin vencimientos configurados no vence nada", () => {
    assert.deepEqual(planExpirations([credit("a", 1000, 1, null)], NOW), []);
  });

  it("una acreditación vencida sin consumos vence completa", () => {
    assert.deepEqual(planExpirations([credit("a", 1000, 1, 10)], NOW), [{ lotId: "a", amountCents: 1000, idempotencyKey: "vence:a" }]);
  });

  it("no vence lo que todavía no llegó a su fecha (el límite exacto ya venció)", () => {
    assert.deepEqual(planExpirations([credit("a", 1000, 1, 21)], NOW), []);
    assert.equal(planExpirations([credit("a", 1000, 1, 20)], NOW).length, 1);
  });

  it("FIFO: el consumo se imputa a la acreditación más vieja, así que vence entera la nueva", () => {
    const rows = [credit("a", 1000, 1, 10), credit("b", 1000, 2, 11), spend(1000, 3)];
    assert.deepEqual(planExpirations(rows, NOW), [{ lotId: "b", amountCents: 1000, idempotencyKey: "vence:b" }]);
  });

  it("un consumo parcial deja el resto de la más vieja, que vence por ese resto", () => {
    const rows = [credit("a", 1000, 1, 10), credit("b", 1000, 2, 11), spend(400, 3)];
    assert.deepEqual(planExpirations(rows, NOW).map((e) => [e.lotId, e.amountCents]), [["a", 600], ["b", 1000]]);
  });

  it("un consumo que cruza varias acreditaciones las agota en orden", () => {
    const rows = [credit("a", 300, 1, 10), credit("b", 300, 2, 10), credit("c", 300, 3, 10), spend(700, 4)];
    assert.deepEqual(planExpirations(rows, NOW).map((e) => [e.lotId, e.amountCents]), [["c", 200]]);
  });

  it("un consumo posterior al vencimiento de la vieja sale de la nueva (la vencida ya no se puede gastar)", () => {
    const rows = [credit("a", 1000, 1, 5), credit("b", 1000, 2, 30), spend(400, 6)];
    assert.deepEqual(planExpirations(rows, NOW).map((e) => [e.lotId, e.amountCents]), [["a", 1000]]);
    assert.deepEqual(lotsOf(rows).map((l) => [l.id, l.remainingCents]), [["a", 1000], ["b", 600]]);
  });

  it("si el proceso corrió tarde y se gastó saldo de una vencida, se imputa a ella solo si no hay otra", () => {
    const rows = [credit("a", 1000, 1, 5), spend(400, 6)];
    assert.deepEqual(planExpirations(rows, NOW).map((e) => [e.lotId, e.amountCents]), [["a", 600]]);
  });

  it("las acreditaciones sin vencimiento (NULL) nunca vencen y absorben consumos por antigüedad", () => {
    const rows = [credit("viejo", 500, 1, null), credit("b", 500, 2, 10), spend(500, 3)];
    assert.deepEqual(planExpirations(rows, NOW), [{ lotId: "b", amountCents: 500, idempotencyKey: "vence:b" }]);
  });

  it("es idempotente: lo ya vencido (asiento 'vencido') no se vuelve a vencer", () => {
    assert.deepEqual(planExpirations([credit("a", 1000, 1, 10), vencido("a", 1000, 11)], NOW), []);
  });

  it("un vencimiento previo parcial no se repite aunque quede resto en el modelo", () => {
    assert.deepEqual(planExpirations([credit("a", 1000, 1, 10), spend(300, 2), vencido("a", 700, 11)], NOW), []);
  });

  it("un consumo posterior a un vencimiento ya registrado sale de las acreditaciones vivas", () => {
    const rows = [credit("a", 1000, 1, 5), vencido("a", 1000, 6), credit("b", 1000, 7, 30), spend(1000, 8)];
    assert.deepEqual(planExpirations(rows, NOW), []);
    assert.deepEqual(lotsOf(rows).map((l) => [l.id, l.remainingCents]), [["a", 0], ["b", 0]]);
  });

  it("la devolución es una acreditación nueva con su propia fecha", () => {
    const rows: Row[] = [
      credit("a", 1000, 1, 30),
      spend(1000, 2),
      { id: "d", delta_cents: 1000, motivo: "devolucion", idempotency_key: "orden:o:credito:devolucion", created_at: at(3), expires_at: at(10) },
    ];
    assert.deepEqual(planExpirations(rows, NOW), [{ lotId: "d", amountCents: 1000, idempotencyKey: "vence:d" }]);
  });

  it("el ajuste manual negativo consume como cualquier débito", () => {
    const rows: Row[] = [credit("a", 1000, 1, 10), { id: "aj", delta_cents: -250, motivo: "ajuste", idempotency_key: "aj1", created_at: at(2), expires_at: null }];
    assert.deepEqual(planExpirations(rows, NOW).map((e) => e.amountCents), [750]);
  });

  it("nunca devuelve montos negativos ni cero aunque los consumos superen lo acreditado (datos inconsistentes)", () => {
    assert.deepEqual(planExpirations([credit("a", 100, 1, 10), spend(500, 2)], NOW), []);
  });

  it("el orden de entrada no importa: se ordena por fecha y a igual instante, primero las acreditaciones", () => {
    const rows = [spend(400, 3), credit("b", 1000, 2, 11), credit("a", 1000, 1, 10)];
    assert.deepEqual(planExpirations(rows, NOW).map((e) => [e.lotId, e.amountCents]), [["a", 600], ["b", 1000]]);
    assert.deepEqual(planExpirations([spend(300, 3, 12), credit("a", 300, 3, 10)], NOW), []);
  });

  it("la suma de lo que vence nunca supera lo que queda de saldo real", () => {
    const rows = [credit("a", 700, 1, 10), credit("b", 900, 2, 12), credit("c", 500, 3, 40), spend(1000, 4), spend(200, 5)];
    const total = rows.reduce((s, r) => s + r.delta_cents, 0);
    const vence = planExpirations(rows, NOW).reduce((s, e) => s + e.amountCents, 0);
    assert.ok(vence <= total);
    assert.equal(total - vence, 500);
  });

  it("no modifica las filas de entrada", () => {
    const rows = [credit("a", 1000, 1, 10), spend(100, 2)];
    const copia = JSON.stringify(rows);
    planExpirations(rows, NOW);
    assert.equal(JSON.stringify(rows), copia);
  });
});
