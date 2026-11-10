import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createFakeShiftsDb } from "./helpers/shifts-db.ts";

// La compuerta real filtra por habilitación: el modo demo (que habilita a todos) no debe estar activo.
delete process.env.NEXT_PUBLIC_DEMO_MODE;

const { courierToVerify } = await import("../src/lib/courier-gate.ts");
const { isCourierApproved } = await import("../src/lib/courier-shifts.ts");

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
    it("reasignar al mismo repartidor que ya lo tiene no se verifica, aunque hoy esté deshabilitado", () => {
      assert.equal(courierToVerify({ role: "admin", ownName: "Local", requested: "Beto", current: "Beto" }), null);
    });
    it("cambiar a un repartidor distinto sí se verifica", () => {
      assert.equal(courierToVerify({ role: "admin", ownName: "Local", requested: "Cata", current: "Beto" }), "Cata");
    });
  });
});

describe("compuerta completa: reasignar con un repartidor deshabilitado hoy", () => {
  const NOW = new Date("2026-11-10T12:00:00Z");
  const approvedNora = { id: "s1", user_id: "u1", courier_name: "Nora", shift_day: "2026-11-10", status: "approved" };
  const rejectedBeto = { id: "s2", user_id: "u2", courier_name: "Beto", shift_day: "2026-11-10", status: "rejected" };

  /** Lo mismo que hace la ruta: verifica solo al nombre que devuelve `courierToVerify`. */
  const blocked = async (requested: string | null, current: string | null): Promise<boolean> => {
    const { db } = createFakeShiftsDb([approvedNora, rejectedBeto]);
    const name = courierToVerify({ role: "admin", ownName: "Local", requested, current });
    return name !== null && !(await isCourierApproved(db, name, NOW));
  };

  it("mismo nombre, deshabilitado: se permite (el pedido ya era suyo)", async () => {
    assert.equal(await blocked("Beto", "Beto"), false);
  });
  it("nombre distinto que no está habilitado: se bloquea (409 en la ruta)", async () => {
    assert.equal(await blocked("Beto", "Nora"), true);
    assert.equal(await blocked("Beto", null), true);
  });
  it("nombre distinto habilitado: se permite", async () => {
    assert.equal(await blocked("Nora", "Beto"), false);
  });
  it("desasignar: se permite", async () => {
    assert.equal(await blocked(null, "Beto"), false);
  });
});
