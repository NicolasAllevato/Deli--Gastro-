import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { isFudoOrigin, fudoOriginLabel } = await import("../src/lib/fudo/origin.ts");

describe("pedidos nacidos en Fudo", () => {
  it("se reconocen por el canal fudo (los enviados por la app a Fudo no cuentan)", () => {
    assert.equal(isFudoOrigin({ channel: "fudo" }), true);
    assert.equal(isFudoOrigin({ channel: "web" }), false);
    assert.equal(isFudoOrigin({ channel: "whatsapp" }), false);
  });

  it("la etiqueta del tablero dice el tipo de venta", () => {
    assert.equal(fudoOriginLabel({ channel: "fudo", fudo_sale_type: "DELIVERY" }), "Fudo · Delivery");
    assert.equal(fudoOriginLabel({ channel: "fudo", fudo_sale_type: "TAKEAWAY" }), "Fudo · Take away");
    assert.equal(fudoOriginLabel({ channel: "fudo", fudo_sale_type: null }), "Fudo");
    assert.equal(fudoOriginLabel({ channel: "web", fudo_sale_type: null }), null);
  });
});
