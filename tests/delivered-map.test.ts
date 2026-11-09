import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { ALL, NO_COURIER, clusterPoints, deliveredChannel, isValidRange, rangeForPreset, selectDelivered } = await import("../src/lib/delivered-map.ts");

const row = (over: Record<string, unknown> = {}) => ({
  id: "a",
  client_id: null,
  customer_name: null,
  status: "Finalizados",
  channel: "fudo",
  fudo_sale_type: "DELIVERY",
  fudo_source: "local",
  delivery_address: null,
  delivery_lat: null,
  delivery_lng: null,
  delivered_lat: null,
  delivered_lng: null,
  courier_name: null,
  created_at: "2026-11-05T12:00:00.000Z",
  ready_at: null,
  picked_up_at: null,
  delivered_at: "2026-11-05T13:00:00.000Z",
  ...over,
});

const range = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-09T00:00:00.000Z", channel: ALL, courier: ALL } as const;

describe("selectDelivered", () => {
  it("cuenta sin ubicación a los que no tienen punto y no inventa", () => {
    const { summary } = selectDelivered([
      row({ id: "1", delivery_lat: -34.6, delivery_lng: -58.4, delivery_address: "A 1" }),
      row({ id: "2", delivery_address: "B 2" }),
      row({ id: "3", fudo_source: "pedidosya" }),
    ], range);
    assert.deepEqual(summary, { total: 3, located: 1, withoutLocation: 2, withoutAddress: 1 });
  });

  it("usa la fecha de creación si la venta vieja no tiene cierre", () => {
    const { summary } = selectDelivered([row({ delivered_at: null })], range);
    assert.equal(summary.total, 1);
  });

  it("deja afuera lo que se entregó fuera del rango aunque se haya creado dentro del margen", () => {
    const { summary } = selectDelivered([row({ created_at: "2026-10-31T20:00:00.000Z", delivered_at: "2026-10-31T21:00:00.000Z" })], range);
    assert.equal(summary.total, 0);
  });

  it("excluye take away y mostrador", () => {
    const { summary } = selectDelivered([row({ fudo_sale_type: "TAKEAWAY" }), row({ id: "m", channel: "mostrador", fudo_sale_type: null, delivery_address: "X" })], range);
    assert.equal(summary.total, 0);
  });

  it("filtra por canal y por sin repartidor, y ofrece los repartidores del canal", () => {
    const all = [row({ id: "1", courier_name: "Ana" }), row({ id: "2" }), row({ id: "3", fudo_source: "rappi", courier_name: "Beto" })];
    const local = selectDelivered(all, { ...range, channel: "delivery_local", courier: NO_COURIER });
    assert.deepEqual(local.rows.map((r: { id: string }) => r.id), ["2"]);
    assert.deepEqual(local.couriers, ["Ana"]);
  });

  it("el total no depende de un tope: cuenta más de 1000", () => {
    const many = Array.from({ length: 1500 }, (_, i) => row({ id: String(i), delivery_lat: -34.6, delivery_lng: -58.4 }));
    assert.equal(selectDelivered(many, range).summary.total, 1500);
  });
});

describe("canal", () => {
  it("separa apps, local y web", () => {
    assert.equal(deliveredChannel({ channel: "fudo", fudo_source: "morfy" }), "morfy");
    assert.equal(deliveredChannel({ channel: "fudo", fudo_source: null }), "delivery_local");
    assert.equal(deliveredChannel({ channel: "whatsapp", fudo_source: null }), "web");
  });
});

describe("rangos", () => {
  const now = new Date(2026, 10, 9, 15, 30);
  it("hoy va de medianoche a medianoche", () => {
    assert.deepEqual(rangeForPreset("hoy", now), { from: new Date(2026, 10, 9).toISOString(), to: new Date(2026, 10, 10).toISOString() });
  });
  it("30 días incluye hoy", () => {
    assert.equal(rangeForPreset("30d", now)?.from, new Date(2026, 9, 11).toISOString());
  });
  it("personalizado incluye el día final y rechaza lo incompleto, invertido o largo", () => {
    assert.equal(rangeForPreset("custom", now, { from: "2026-11-01", to: "2026-11-02" })?.to, new Date(2026, 10, 3).toISOString());
    assert.equal(rangeForPreset("custom", now, { from: "2026-11-01", to: "" }), null);
    assert.equal(rangeForPreset("custom", now, { from: "2026-11-05", to: "2026-11-01" }), null);
    assert.equal(rangeForPreset("custom", now, { from: "2026-01-01", to: "2026-11-01" }), null);
  });
  it("valida el servidor", () => {
    assert.equal(isValidRange("2026-11-02T00:00:00.000Z", "2026-11-01T00:00:00.000Z"), false);
  });
});

describe("clusterPoints", () => {
  const point = (p: { lat: number; lng: number }) => p;
  const near = Array.from({ length: 50 }, (_, i) => ({ lat: -34.6 + i * 1e-6, lng: -58.4 }));

  it("agrupa muchos puntos cercanos y conserva todos", () => {
    const groups = clusterPoints(near, point, 12);
    assert.ok(groups.length < 5);
    assert.equal(groups.reduce((n: number, g: { items: unknown[] }) => n + g.items.length, 0), 50);
  });
  it("no agrupa con pocos puntos ni de muy cerca", () => {
    assert.equal(clusterPoints(near.slice(0, 5), point, 12).length, 5);
    assert.equal(clusterPoints(near, point, 18).length, 50);
  });
  it("saltea lo que no tiene punto", () => {
    assert.equal(clusterPoints([1, 2], (n: number) => (n === 1 ? { lat: 0, lng: 0 } : null), 10).length, 1);
  });
});
