import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findZone,
  findZoneIn,
  orderZones,
  pointInShape,
  quoteDelivery,
  type DeliveryZone,
} from "../src/lib/zones.ts";

const LOCAL = { lat: -34.6, lng: -58.39 };

function zone(partial: Partial<DeliveryZone> & Pick<DeliveryZone, "id" | "shape">): DeliveryZone {
  return { name: partial.id, fee: 500, min_order: 0, sort_order: 0, is_active: true, ...partial };
}

const near = zone({
  id: "cerca",
  fee: 600,
  shape: { type: "circle", lat: LOCAL.lat, lng: LOCAL.lng, radius_km: 2 },
});
const far = zone({
  id: "lejos",
  fee: 1200,
  sort_order: 1,
  shape: { type: "circle", lat: LOCAL.lat, lng: LOCAL.lng, radius_km: 6 },
});
// Cuadrado de ~2 km de lado al norte del local.
const north = zone({
  id: "norte",
  fee: 900,
  min_order: 5000,
  sort_order: 2,
  shape: {
    type: "polygon",
    points: [
      [-34.55, -58.4],
      [-34.55, -58.38],
      [-34.53, -58.38],
      [-34.53, -58.4],
    ],
  },
});

describe("pointInShape", () => {
  it("círculo: adentro y afuera", () => {
    assert.ok(pointInShape({ lat: -34.605, lng: -58.39 }, near.shape));
    assert.equal(pointInShape({ lat: -34.65, lng: -58.39 }, near.shape), false);
  });

  it("polígono: adentro y afuera", () => {
    assert.ok(pointInShape({ lat: -34.54, lng: -58.39 }, north.shape));
    assert.equal(pointInShape({ lat: -34.56, lng: -58.39 }, north.shape), false);
    assert.equal(pointInShape({ lat: -34.54, lng: -58.5 }, north.shape), false);
  });

  it("un polígono con menos de 3 puntos no cubre nada", () => {
    const degenerate = { type: "polygon", points: [[-34.5, -58.4], [-34.5, -58.3]] } as const;
    assert.equal(pointInShape({ lat: -34.5, lng: -58.35 }, degenerate), false);
  });
});

describe("findZone", () => {
  it("elige la primera zona activa según sort_order", () => {
    const point = { lat: -34.601, lng: -58.39 }; // dentro de cerca y de lejos
    assert.equal(findZone(point, [far, near, north])?.id, "cerca");
  });

  it("ignora las zonas inactivas", () => {
    const point = { lat: -34.601, lng: -58.39 };
    const off = { ...near, is_active: false };
    assert.equal(findZone(point, [off, far])?.id, "lejos");
  });

  it("devuelve null si ninguna zona cubre el punto", () => {
    assert.equal(findZone({ lat: -35.5, lng: -58.39 }, [near, far, north]), null);
  });
});

describe("orderZones / findZoneIn", () => {
  const inactive = zone({ id: "off", sort_order: -1, is_active: false, shape: near.shape });
  const all = [far, inactive, north, near];

  it("orderZones filtra inactivas, ordena por sort_order y no muta la entrada", () => {
    const copy = [...all];
    const expected = all.filter((z) => z.is_active).sort((a, b) => a.sort_order - b.sort_order).map((z) => z.id);
    assert.deepEqual(orderZones(all).map((z) => z.id), expected);
    assert.deepEqual(all, copy);
  });

  it("findZoneIn con zonas preordenadas da lo mismo que findZone", () => {
    const ordered = orderZones(all);
    const points = [LOCAL, { lat: -34.5, lng: -58.39 }, { lat: -35.5, lng: -58.39 }, { lat: -34.58, lng: -58.45 }];
    for (const point of points) {
      assert.equal(findZoneIn(point, ordered)?.id ?? null, findZone(point, all)?.id ?? null);
    }
  });
});

describe("quoteDelivery", () => {
  const opts = { local: LOCAL, radiusKm: 5, costPerKm: 150 };

  it("con zonas, cobra la tarifa de la zona y devuelve el pedido mínimo", () => {
    const quote = quoteDelivery({ lat: -34.54, lng: -58.39 }, [near, far, north], opts);
    assert.deepEqual(quote, { covered: true, fee: 900, minOrder: 5000, zone: "norte" });
  });

  it("con zonas, rechaza lo que ninguna cubre aunque entre en el radio", () => {
    const quote = quoteDelivery({ lat: -34.62, lng: -58.5 }, [near], opts);
    assert.equal(quote.covered, false);
  });

  it("sin zonas activas usa el radio y la tarifa por km", () => {
    const quote = quoteDelivery({ lat: -34.6, lng: -58.39 }, [], opts);
    assert.deepEqual(quote, { covered: true, fee: 500, minOrder: 0, zone: null });
  });

  it("sin zonas, rechaza lo que supera el radio", () => {
    const quote = quoteDelivery({ lat: -34.0, lng: -58.39 }, [], opts);
    assert.equal(quote.covered, false);
  });
});
