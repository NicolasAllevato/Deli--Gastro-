import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { promoListSchema, promosForToday, parsePromos, weekdayInArgentina, type Promo } from "../src/lib/promos.ts";

const base: Promo = {
  id: "p1",
  tipo: "promocion",
  titulo: "2x1 en pizzas",
  descripcion: "Todas las pizzas grandes",
  productId: null,
  dias: [],
  activa: true,
};

// 2026-10-14 15:00 UTC = miércoles 12:00 en Buenos Aires.
const MIERCOLES = new Date("2026-10-14T15:00:00Z");

describe("promociones y sugerencias del día", () => {
  it("el día se toma en hora de Argentina, no en UTC", () => {
    assert.equal(weekdayInArgentina(MIERCOLES), 3);
    // 2026-10-15 01:30 UTC sigue siendo miércoles 22:30 en Buenos Aires.
    assert.equal(weekdayInArgentina(new Date("2026-10-15T01:30:00Z")), 3);
  });

  it("sin días elegidos, aparece todos los días", () => {
    assert.equal(promosForToday([base], MIERCOLES).length, 1);
  });

  it("con días elegidos, solo esos días", () => {
    assert.equal(promosForToday([{ ...base, dias: [3] }], MIERCOLES).length, 1);
    assert.equal(promosForToday([{ ...base, dias: [1, 5] }], MIERCOLES).length, 0);
  });

  it("las inactivas no aparecen", () => {
    assert.equal(promosForToday([{ ...base, activa: false }], MIERCOLES).length, 0);
  });

  it("valida título, tipo y días", () => {
    assert.equal(promoListSchema.safeParse([base]).success, true);
    assert.equal(promoListSchema.safeParse([{ ...base, titulo: "" }]).success, false);
    assert.equal(promoListSchema.safeParse([{ ...base, tipo: "otro" }]).success, false);
    assert.equal(promoListSchema.safeParse([{ ...base, dias: [7] }]).success, false);
    assert.equal(promoListSchema.safeParse([{ ...base, productId: "no-uuid" }]).success, false);
  });

  it("limita la cantidad para no saturar la pantalla", () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ ...base, id: `p${i}` }));
    assert.equal(promoListSchema.safeParse(many).success, false);
  });

  it("parsePromos tolera valores corruptos de la configuración", () => {
    assert.deepEqual(parsePromos(null), []);
    assert.deepEqual(parsePromos("texto"), []);
    assert.deepEqual(parsePromos([base, { roto: true }]), [base]);
  });
});
