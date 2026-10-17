import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeDurations, courierMayPatch, stagePatch } from "../src/lib/tracking.ts";

describe("courierMayPatch", () => {
  const free = { status: "En Camino", courier_name: null } as const;
  const mine = { status: "En Camino", courier_name: "Diego" } as const;
  const theirs = { status: "En Camino", courier_name: "Otro" } as const;

  it("puede tomar un pedido libre que está en camino", () => {
    assert.ok(courierMayPatch(free, "Diego", { courier_name: "Diego" }));
  });

  it("no puede asignarle el pedido a otra persona", () => {
    assert.equal(courierMayPatch(free, "Diego", { courier_name: "Otro" }), false);
  });

  it("puede marcar la salida solo de un pedido propio", () => {
    assert.ok(courierMayPatch(mine, "Diego", { picked_up: true }));
    assert.equal(courierMayPatch(free, "Diego", { picked_up: true }), false);
    assert.equal(courierMayPatch(theirs, "Diego", { picked_up: true }), false);
  });

  it("puede entregar un pedido propio o libre, no uno ajeno", () => {
    assert.ok(courierMayPatch(mine, "Diego", { status: "Finalizados" }));
    assert.ok(courierMayPatch(free, "Diego", { status: "Finalizados" }));
    assert.equal(courierMayPatch(theirs, "Diego", { status: "Finalizados" }), false);
  });

  it("no puede tocar pedidos que no están en camino", () => {
    const cooking = { status: "En Preparación", courier_name: "Diego" } as const;
    assert.equal(courierMayPatch(cooking, "Diego", { picked_up: true }), false);
    assert.equal(courierMayPatch(cooking, "Diego", { status: "Finalizados" }), false);
  });

  it("no puede mezclar acciones ni cambiar otros estados", () => {
    assert.equal(courierMayPatch(mine, "Diego", { status: "Cancelado" }), false);
    assert.equal(courierMayPatch(mine, "Diego", { status: "Finalizados", picked_up: true }), false);
  });
});

const NOW = new Date("2026-10-03T15:00:00.000Z");

describe("stagePatch", () => {
  it("marca la hora de aceptación al pasar a En Preparación", () => {
    assert.deepEqual(stagePatch("En Preparación", NOW), { accepted_at: NOW.toISOString() });
  });

  it("marca la hora de listo/despacho al pasar a En Camino", () => {
    assert.deepEqual(stagePatch("En Camino", NOW), { ready_at: NOW.toISOString() });
  });

  it("marca la hora de entrega al finalizar", () => {
    assert.deepEqual(stagePatch("Finalizados", NOW), { delivered_at: NOW.toISOString() });
  });

  it("no marca nada para Recibidos ni Cancelado", () => {
    assert.deepEqual(stagePatch("Recibidos", NOW), {});
    assert.deepEqual(stagePatch("Cancelado", NOW), {});
  });
});

describe("computeDurations", () => {
  const base = {
    created_at: "2026-10-03T14:00:00.000Z",
    accepted_at: "2026-10-03T14:02:00.000Z",
    ready_at: "2026-10-03T14:20:00.000Z",
    picked_up_at: "2026-10-03T14:25:00.000Z",
    delivered_at: "2026-10-03T14:45:00.000Z",
  };

  it("calcula cocina, espera de despacho, ruta y total en minutos", () => {
    assert.deepEqual(computeDurations(base), {
      kitchen: 18,
      dispatchWait: 5,
      route: 20,
      total: 45,
    });
  });

  it("devuelve null en las etapas que todavía no ocurrieron", () => {
    const partial = { ...base, picked_up_at: null, delivered_at: null };
    assert.deepEqual(computeDurations(partial), {
      kitchen: 18,
      dispatchWait: null,
      route: null,
      total: null,
    });
  });

  it("no devuelve valores negativos si los datos vienen desordenados", () => {
    const messy = { ...base, ready_at: "2026-10-03T13:00:00.000Z" };
    assert.equal(computeDurations(messy).kitchen, 0);
  });
});
