import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { argentinaDay, argentinaDayRangeUtc, toUtcIso } from "../src/lib/data/time.ts";
import { toCents, fromCents, assertCents } from "../src/lib/data/money.ts";
import { dataBackend, usesD1 } from "../src/lib/data/backend.ts";

describe("time: UTC ↔ día argentino", () => {
  it("02:59 UTC es el día anterior en Argentina", () => {
    assert.equal(argentinaDay("2026-11-13T02:59:59.000Z"), "2026-11-12");
    assert.equal(argentinaDay("2026-11-13T03:00:00.000Z"), "2026-11-13");
  });
  it("rango UTC de un día argentino", () => {
    assert.deepEqual(argentinaDayRangeUtc("2026-11-12"), {
      from: "2026-11-12T03:00:00.000Z",
      to: "2026-11-13T03:00:00.000Z",
    });
  });
  it("cruce de mes y año", () => {
    assert.deepEqual(argentinaDayRangeUtc("2026-12-31"), { from: "2026-12-31T03:00:00.000Z", to: "2027-01-01T03:00:00.000Z" });
  });
  it("rechaza entradas inválidas", () => {
    assert.throws(() => argentinaDay("no-fecha"));
    assert.throws(() => argentinaDayRangeUtc("2026-1-1"));
    assert.throws(() => toUtcIso("x"));
  });
  it("toUtcIso normaliza offsets", () => {
    assert.equal(toUtcIso("2026-11-12T21:00:00-03:00"), "2026-11-13T00:00:00.000Z");
  });
});

describe("money: centavos enteros", () => {
  it("convierte sin error de coma flotante", () => {
    assert.equal(toCents(1.005), 101);
    assert.equal(toCents("12500.50"), 1250050);
    assert.equal(toCents(0.1 + 0.2), 30);
    assert.equal(fromCents(1250050), 12500.5);
  });
  it("rechaza no números y centavos no enteros", () => {
    assert.throws(() => toCents("abc"));
    assert.throws(() => fromCents(1.5));
    assert.throws(() => assertCents(-1));
    assert.throws(() => assertCents(10.2));
    assert.equal(assertCents(0), 0);
  });
});

describe("DATA_BACKEND", () => {
  it("default supabase y valores desconocidos caen en supabase", () => {
    assert.equal(dataBackend({}), "supabase");
    assert.equal(dataBackend({ DATA_BACKEND: "postgres" }), "supabase");
    assert.equal(dataBackend({ DATA_BACKEND: " D1 " }), "d1");
    assert.equal(dataBackend({ DATA_BACKEND: "dual" }), "dual");
    assert.equal(usesD1({}), false);
  });
});
