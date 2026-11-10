import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { courierToVerify } from "../src/lib/courier-gate.ts";

describe("compuerta de habilitación en PATCH /api/orders: a quién hay que verificar", () => {
  describe("repartidor", () => {
    it("al tomar un pedido se verifica a sí mismo", () => {
      assert.equal(courierToVerify({ role: "repartidor", ownName: "Nora", requested: "Nora", current: null }), "Nora");
    });
    it("al entregar o marcar la salida (sin tocar courier_name) no se verifica a nadie", () => {
      assert.equal(courierToVerify({ role: "repartidor", ownName: "Nora", requested: undefined, current: "Nora" }), null);
      assert.equal(courierToVerify({ role: "repartidor", ownName: "Nora", requested: undefined, current: null }), null);
    });
  });

  describe("admin", () => {
    it("al asignar un repartidor se verifica el nombre pedido, no el del admin", () => {
      assert.equal(courierToVerify({ role: "admin", ownName: "Local", requested: "Beto", current: null }), "Beto");
    });
    it("al desasignar (null) no se verifica a nadie", () => {
      assert.equal(courierToVerify({ role: "admin", ownName: "Local", requested: null, current: "Beto" }), null);
    });
    it("si no toca courier_name no se verifica a nadie", () => {
      assert.equal(courierToVerify({ role: "admin", ownName: "Local", requested: undefined, current: "Beto" }), null);
    });
  });
});
