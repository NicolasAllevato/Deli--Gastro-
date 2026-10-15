import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decideInboundLimit, LIMITS } from "../src/lib/agent/limits.ts";

describe("decideInboundLimit", () => {
  it("deja pasar el tráfico normal", () => {
    assert.equal(decideInboundLimit({ lastMinute: 3, lastDay: 20 }), "ok");
    assert.equal(decideInboundLimit({ lastMinute: LIMITS.perMinute, lastDay: 20 }), "ok");
  });

  it("avisa una sola vez al pasar el tope por minuto y después calla", () => {
    assert.equal(decideInboundLimit({ lastMinute: LIMITS.perMinute + 1, lastDay: 20 }), "notify");
    assert.equal(decideInboundLimit({ lastMinute: LIMITS.perMinute + 2, lastDay: 20 }), "silent");
  });

  it("aplica un tope diario para acotar el costo de IA", () => {
    assert.equal(decideInboundLimit({ lastMinute: 1, lastDay: LIMITS.perDay + 1 }), "notify");
    assert.equal(decideInboundLimit({ lastMinute: 1, lastDay: LIMITS.perDay + 2 }), "silent");
  });
});
