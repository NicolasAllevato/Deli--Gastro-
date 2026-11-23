import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { quoteSchema, MAX_QTY } from "../src/lib/bot-internal/schemas.ts";

const PID = "00000000-0000-4000-8000-000000000001";
const base = { address: "Belgrano 123" };

describe("quoteSchema: cantidad por línea", () => {
  it("acepta hasta 100 unidades por línea (empanadas en cualquier cantidad)", () => {
    assert.equal(MAX_QTY, 100);
    const ok = quoteSchema.safeParse({ ...base, items: [{ product_id: PID, qty: 100 }] });
    assert.ok(ok.success || !JSON.stringify(ok.error.issues).includes("qty"), "qty 100 no debe rechazarse");
  });

  it("rechaza 101", () => {
    const bad = quoteSchema.safeParse({ ...base, items: [{ product_id: PID, qty: 101 }] });
    assert.equal(bad.success, false);
  });
});
