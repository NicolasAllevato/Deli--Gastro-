import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  RESTAURANT_LOCATION,
  SAMPLE_ADDRESSES,
  calcDeliveryFee,
  haversineKm,
} from "../src/lib/restaurant.ts";

describe("distancia y envío", () => {
  it("la distancia de un punto a sí mismo es 0", () => {
    assert.equal(haversineKm(RESTAURANT_LOCATION, RESTAURANT_LOCATION), 0);
  });

  it("es simétrica", () => {
    const a = SAMPLE_ADDRESSES[0]!;
    const b = SAMPLE_ADDRESSES[4]!;
    assert.ok(Math.abs(haversineKm(a, b) - haversineKm(b, a)) < 1e-9);
  });

  it("un grado de latitud son ~111 km", () => {
    const km = haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 });
    assert.ok(km > 110 && km < 112, `km=${km}`);
  });

  it("todas las direcciones de ejemplo caen dentro de la zona de 8 km", () => {
    for (const address of SAMPLE_ADDRESSES) {
      assert.ok(haversineKm(RESTAURANT_LOCATION, address) <= 8, address.address);
    }
  });

  it("el envío es tarifa base + costo por km, redondeado a $10", () => {
    assert.equal(calcDeliveryFee(0, 150), 500);
    assert.equal(calcDeliveryFee(2, 150), 800);
    assert.equal(calcDeliveryFee(0.9, 150), 640);
  });

  it("un costo por km más alto encarece el envío", () => {
    assert.ok(calcDeliveryFee(5, 300) > calcDeliveryFee(5, 150));
  });
});
