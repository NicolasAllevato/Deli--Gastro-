import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseSalesRange } from "../workers/fudo-gateway/src/sales.ts";

const q = (s: string) => new URLSearchParams(s);

describe("parseSalesRange", () => {
  it("sin from/to devuelve null (ventana por defecto)", () => {
    assert.equal(parseSalesRange(q("dry=1")), null);
  });
  it("acepta un rango válido", () => {
    const r = parseSalesRange(q("from=2026-10-01T03:00:00Z&to=2026-10-08T03:00:00Z"));
    assert.equal(r?.from.toISOString(), "2026-10-01T03:00:00.000Z");
    assert.equal(r?.to.toISOString(), "2026-10-08T03:00:00.000Z");
  });
  it("rechaza fechas inválidas o incompletas", () => {
    assert.throws(() => parseSalesRange(q("from=ayer&to=hoy")));
    assert.throws(() => parseSalesRange(q("from=2026-10-01T00:00:00Z")));
  });
  it("rechaza to anterior a from", () => {
    assert.throws(() => parseSalesRange(q("from=2026-10-05T00:00:00Z&to=2026-10-01T00:00:00Z")));
  });
  it("rechaza rangos de más de 7 días", () => {
    assert.throws(() => parseSalesRange(q("from=2026-10-01T00:00:00Z&to=2026-10-09T00:00:00Z")));
  });
});
