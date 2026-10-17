import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NEXT_STATUSES,
  buildItemsDesc,
  elapsedTone,
  formatElapsed,
  canTransition,
  formatOrderId,
  isActiveStatus,
  minutesSince,
  parseItems,
  pointsForLines,
  pointsForTotal,
  tierForPoints,
} from "../src/lib/orders.ts";

describe("ciclo de vida del pedido", () => {
  it("permite el camino feliz", () => {
    assert.ok(canTransition("Recibidos", "En Preparación"));
    assert.ok(canTransition("En Preparación", "En Camino"));
    assert.ok(canTransition("En Camino", "Finalizados"));
  });

  it("no permite saltear etapas ni retroceder", () => {
    assert.equal(canTransition("Recibidos", "En Camino"), false);
    assert.equal(canTransition("Recibidos", "Finalizados"), false);
    assert.equal(canTransition("En Camino", "Recibidos"), false);
  });

  it("los estados finales no tienen salida", () => {
    assert.deepEqual(NEXT_STATUSES.Finalizados, []);
    assert.deepEqual(NEXT_STATUSES.Cancelado, []);
    assert.equal(canTransition("Cancelado", "Recibidos"), false);
  });

  it("se puede cancelar mientras el pedido está activo", () => {
    for (const status of ["Recibidos", "En Preparación", "En Camino"] as const) {
      assert.ok(canTransition(status, "Cancelado"), status);
    }
  });

  it("distingue pedidos activos de cerrados", () => {
    assert.ok(isActiveStatus("En Camino"));
    assert.equal(isActiveStatus("Finalizados"), false);
    assert.equal(isActiveStatus("Cancelado"), false);
  });
});

describe("detalle de ítems", () => {
  it("parsea y reconstruye el formato '2x Pizza · 1x Papas'", () => {
    const lines = parseItems("2x Pizza Margarita · 1x Papas Fritas");
    assert.deepEqual(lines, [
      { qty: 2, name: "Pizza Margarita" },
      { qty: 1, name: "Papas Fritas" },
    ]);
    assert.equal(buildItemsDesc(lines), "2x Pizza Margarita · 1x Papas Fritas");
  });

  it("trata el texto libre (pedido de mostrador) como una sola línea", () => {
    assert.deepEqual(parseItems("2 items • Delivery"), [{ qty: 1, name: "2 items • Delivery" }]);
  });

  it("ignora segmentos vacíos", () => {
    assert.deepEqual(parseItems(""), []);
  });
});

describe("puntos y niveles", () => {
  it("acredita puntos por cada $100 redondeando hacia abajo", () => {
    assert.equal(pointsForTotal(25080, 0.5), 125);
    assert.equal(pointsForTotal(199, 0.5), 0);
    assert.equal(pointsForTotal(10000, 1), 100);
  });

  it("nunca devuelve puntos negativos", () => {
    assert.equal(pointsForTotal(-500, 1), 0);
  });

  it("calcula el nivel con los umbrales por defecto", () => {
    assert.equal(tierForPoints(0), "Bronce");
    assert.equal(tierForPoints(149), "Bronce");
    assert.equal(tierForPoints(150), "Plata");
    assert.equal(tierForPoints(300), "Oro");
    assert.equal(tierForPoints(9999), "Platino");
  });

  it("respeta umbrales configurados", () => {
    const tiers = [
      { nombre: "Bronce", desde: 0 },
      { nombre: "Plata", desde: 50 },
    ];
    assert.equal(tierForPoints(60, tiers), "Plata");
  });

  it("cae en Bronce si el nombre del nivel no es válido", () => {
    assert.equal(tierForPoints(10, [{ nombre: "Diamante", desde: 0 }]), "Bronce");
  });
});

describe("helpers de presentación", () => {
  it("formatea el id corto del pedido", () => {
    assert.equal(formatOrderId("d23d3ab5-0a17-4dd4-8ee1-4a1be0aa782a"), "#D23D3AB5");
  });

  it("calcula minutos transcurridos sin dar negativos", () => {
    const now = Date.parse("2026-01-01T12:10:00Z");
    assert.equal(minutesSince("2026-01-01T12:00:00Z", now), 10);
    assert.equal(minutesSince("2026-01-01T12:30:00Z", now), 0);
  });
});

describe("contador de tiempo del pedido", () => {
  it("formatElapsed muestra mm:ss y suma horas cuando corresponde", () => {
    assert.equal(formatElapsed(0), "00:00");
    assert.equal(formatElapsed(65_000), "01:05");
    assert.equal(formatElapsed(59 * 60_000 + 59_000), "59:59");
    assert.equal(formatElapsed(3_725_000), "1:02:05");
  });

  it("formatElapsed no devuelve negativos", () => {
    assert.equal(formatElapsed(-5_000), "00:00");
  });

  it("elapsedTone sube de ok a warn y late según los minutos", () => {
    assert.equal(elapsedTone(9 * 60_000 + 59_000), "ok");
    assert.equal(elapsedTone(10 * 60_000), "warn");
    assert.equal(elapsedTone(24 * 60_000), "warn");
    assert.equal(elapsedTone(25 * 60_000), "late");
  });
});

describe("puntos por plato y por categoría", () => {
  it("el plato con puntos propios ignora los de su categoría", () => {
    const points = pointsForLines([
      { price: 10000, qty: 1, productRate: 3, categoryRate: 1 },
    ]);
    assert.equal(points, 300); // 10000 / 100 * 3
  });

  it("sin puntos propios usa los de la categoría", () => {
    assert.equal(pointsForLines([{ price: 8000, qty: 2, productRate: null, categoryRate: 0.5 }]), 80);
  });

  it("sin puntos en plato ni categoría no suma", () => {
    assert.equal(pointsForLines([{ price: 8000, qty: 1, productRate: null, categoryRate: null }]), 0);
  });

  it("un plato con 0 propio no suma aunque la categoría sí", () => {
    assert.equal(pointsForLines([{ price: 8000, qty: 1, productRate: 0, categoryRate: 2 }]), 0);
  });

  it("suma todas las líneas y redondea hacia abajo una sola vez", () => {
    const points = pointsForLines([
      { price: 950, qty: 1, productRate: null, categoryRate: 1 }, // 9.5
      { price: 950, qty: 1, productRate: null, categoryRate: 1 }, // 9.5
    ]);
    assert.equal(points, 19);
  });
});
