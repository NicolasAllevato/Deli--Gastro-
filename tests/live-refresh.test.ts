import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FALLBACK_POLL_MS, orderTopic, planLiveRefresh, TOPIC_ALL_ORDERS } from "../src/lib/live-refresh.ts";

describe("planLiveRefresh", () => {
  it("en producción se suscribe y deja la consulta periódica solo como respaldo lento", () => {
    const plan = planLiveRefresh({ demo: false, enabled: true, demoPollMs: 5000 });
    assert.deepEqual(plan, { subscribe: true, pollMs: FALLBACK_POLL_MS });
  });

  it("en demo no hay tiempo real: consulta seguido con el intervalo pedido", () => {
    const plan = planLiveRefresh({ demo: true, enabled: true, demoPollMs: 4000 });
    assert.deepEqual(plan, { subscribe: false, pollMs: 4000 });
  });

  it("si está deshabilitado no se suscribe ni consulta (pedido ya finalizado)", () => {
    assert.deepEqual(planLiveRefresh({ demo: false, enabled: false, demoPollMs: 5000 }), { subscribe: false, pollMs: null });
    assert.deepEqual(planLiveRefresh({ demo: true, enabled: false, demoPollMs: 5000 }), { subscribe: false, pollMs: null });
  });

  it("el respaldo es bastante más lento que el polling de demo", () => {
    assert.ok(FALLBACK_POLL_MS >= 20_000);
  });
});

describe("canales", () => {
  it("el canal general y el de un pedido coinciden con los que emite el trigger de la migración 010", () => {
    assert.equal(TOPIC_ALL_ORDERS, "orders");
    assert.equal(orderTopic("abc-123"), "order:abc-123");
  });
});
