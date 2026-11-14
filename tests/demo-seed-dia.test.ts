/**
 * El E2E del mapa ("lo entregado hoy") fallaba en el CI a las 00:02 AR: el seed del demo usa horas
 * relativas y, armado poco antes o después de la medianoche argentina, dejaba las ventas "de hoy" en el
 * día anterior. Se simula la hora del seed para comprobar que siempre caen en el día argentino.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";

const { buildSeed, keepInArgentinaDay } = await import("../src/lib/demo/seed.ts");
const { dayKeyAR } = await import("../src/lib/time-ar.ts");
const { rangeForPreset } = await import("../src/lib/delivered-map.ts");

const realNow = Date.now;
afterEach(() => { Date.now = realNow; });

function seedAt(iso: string) {
  Date.now = () => new Date(iso).getTime();
  return buildSeed();
}

/** Las ventas de Fudo del demo (las que el mapa lista "hoy"). */
const fudoToday = (orders: Record<string, unknown>[]) =>
  orders.filter((o) => o.channel === "fudo" && Number(o.fudo_order_id) >= 90_000 && Number(o.fudo_order_id) < 91_000);

describe("seed del demo y día argentino", () => {
  for (const at of [
    "2026-11-14T03:01:00Z", // 00:01 AR (justo después de medianoche, como el CI que falló)
    "2026-11-14T03:00:20Z", // 00:00:20 AR
    "2026-11-14T02:58:00Z", // 23:58 AR
    "2026-11-14T18:23:27Z", // 15:23 AR (caso normal)
  ]) {
    it(`seed a las ${at}: las ventas de hoy caen en el día argentino del seed`, () => {
      const seed = seedAt(at);
      const hoy = dayKeyAR(at);
      const ventas = fudoToday(seed.orders as Record<string, unknown>[]);
      assert.equal(ventas.length, 10);
      for (const o of ventas) {
        assert.equal(dayKeyAR(String(o.created_at)), hoy, `created_at ${o.customer_name}`);
        assert.equal(dayKeyAR(String(o.delivered_at)), hoy, `delivered_at ${o.customer_name}`);
      }
      // Lo que pide el mapa con el preset "hoy" en ese momento incluye a Marta Gómez (el caso del E2E).
      const range = rangeForPreset("hoy", new Date(at))!;
      const marta = ventas.find((o) => o.customer_name === "Marta Gómez")!;
      assert.ok(String(marta.delivered_at) >= range.from && String(marta.delivered_at) < range.to);
    });
  }

  it("keepInArgentinaDay no toca lo que ya está en el día", () => {
    const base = new Date("2026-11-14T18:23:27Z").getTime();
    assert.equal(keepInArgentinaDay("2026-11-14T17:00:00.000Z", base, 1), "2026-11-14T17:00:00.000Z");
    assert.equal(keepInArgentinaDay("2026-11-14T02:00:00.000Z", base, 5), "2026-11-14T03:00:05.000Z");
  });
});
