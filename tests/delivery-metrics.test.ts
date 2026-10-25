import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { deliveryTimes, distanceMeters, isSameLocalDay } = await import("../src/lib/delivery-metrics.ts");

describe("deliveryTimes", () => {
  it("mide la espera total y el viaje desde que salió", () => {
    assert.deepEqual(
      deliveryTimes({
        created_at: "2026-10-24T12:00:00Z",
        ready_at: "2026-10-24T12:20:00Z",
        picked_up_at: "2026-10-24T12:25:00Z",
        delivered_at: "2026-10-24T12:43:00Z",
      }),
      { totalMin: 43, rideMin: 18 },
    );
  });

  it("sin 'salí' toma desde que quedó listo; sin entrega no hay tiempos", () => {
    const base = { created_at: "2026-10-24T12:00:00Z", ready_at: "2026-10-24T12:20:00Z", picked_up_at: null };
    assert.equal(deliveryTimes({ ...base, delivered_at: "2026-10-24T12:50:00Z" }).rideMin, 30);
    assert.deepEqual(deliveryTimes({ ...base, delivered_at: null }), { totalMin: null, rideMin: null });
  });
});

describe("distanceMeters", () => {
  it("calcula distancias cortas en la ciudad", () => {
    assert.equal(distanceMeters({ lat: -34.6037, lng: -58.3816 }, { lat: -34.6037, lng: -58.3816 }), 0);
    const d = distanceMeters({ lat: -34.6037, lng: -58.3816 }, { lat: -34.6127, lng: -58.3816 });
    assert.ok(d > 990 && d < 1010, `esperaba ~1 km, dio ${d}`);
  });
});

describe("isSameLocalDay", () => {
  it("compara contra el día de hoy", () => {
    const now = new Date();
    assert.ok(isSameLocalDay(now.toISOString(), now));
    assert.equal(isSameLocalDay(new Date(now.getTime() - 2 * 86_400_000).toISOString(), now), false);
    assert.equal(isSameLocalDay(null, now), false);
  });
});
