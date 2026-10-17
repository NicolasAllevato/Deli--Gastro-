import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig } from "./helpers/demo-db.ts";

const { listZones, localFromConfig, loadDeliverySettings, zoneInputSchema, zoneShapeSchema } =
  await import("../src/lib/zones-server.ts");
const { RESTAURANT_LOCATION } = await import("../src/lib/restaurant.ts");

describe("zoneShapeSchema / zoneInputSchema", () => {
  it("acepta círculos y polígonos válidos", () => {
    assert.ok(zoneShapeSchema.safeParse({ type: "circle", lat: -34.6, lng: -58.4, radius_km: 3 }).success);
    assert.ok(
      zoneShapeSchema.safeParse({ type: "polygon", points: [[-34, -58], [-34, -59], [-35, -58]] }).success,
    );
  });

  it("rechaza coordenadas fuera de rango, radios inválidos y polígonos con menos de 3 puntos", () => {
    assert.ok(!zoneShapeSchema.safeParse({ type: "circle", lat: 95, lng: 0, radius_km: 1 }).success);
    assert.ok(!zoneShapeSchema.safeParse({ type: "circle", lat: 0, lng: 0, radius_km: 0 }).success);
    assert.ok(!zoneShapeSchema.safeParse({ type: "circle", lat: 0, lng: 0, radius_km: 500 }).success);
    assert.ok(!zoneShapeSchema.safeParse({ type: "polygon", points: [[0, 0], [1, 1]] }).success);
  });

  it("valida nombre, tarifa y mínimo", () => {
    const shape = { type: "circle", lat: 0, lng: 0, radius_km: 2 };
    assert.ok(zoneInputSchema.safeParse({ name: " Centro ", shape, fee: 500, min_order: 0 }).success);
    assert.ok(!zoneInputSchema.safeParse({ name: "  ", shape, fee: 500, min_order: 0 }).success);
    assert.ok(!zoneInputSchema.safeParse({ name: "A", shape, fee: -1, min_order: 0 }).success);
    assert.ok(!zoneInputSchema.safeParse({ name: "A", shape, fee: 1, min_order: Infinity }).success);
  });
});

describe("listZones", () => {
  it("devuelve las zonas ordenadas por prioridad con montos numéricos", async () => {
    const { db } = createDemoDb();
    const zones = await listZones(db);
    assert.ok(zones.length >= 2);
    assert.deepEqual(
      zones.map((z) => z.sort_order),
      [...zones.map((z) => z.sort_order)].sort((a, b) => a - b),
    );
    assert.equal(zones[0]!.name, "Zona cercana");
    assert.equal(typeof zones[0]!.fee, "number");
  });

  it("descarta las filas con una forma inválida en vez de romper", async () => {
    const { db, store } = createDemoDb();
    const before = (await listZones(db)).length;
    store.delivery_zones.push({ id: crypto.randomUUID(), name: "Rota", shape: { type: "hexagon" }, fee: 1, min_order: 0, sort_order: 99, is_active: true });
    assert.equal((await listZones(db)).length, before);
  });
});

describe("localFromConfig / loadDeliverySettings", () => {
  it("usa la ubicación fija del local si la configuración no la trae", () => {
    assert.deepEqual(localFromConfig({}), { lat: RESTAURANT_LOCATION.lat, lng: RESTAURANT_LOCATION.lng });
    assert.deepEqual(localFromConfig({ local_lat: "-34.5", local_lng: -58.5 }), { lat: -34.5, lng: -58.5 });
  });

  it("junta configuración, zonas y opciones de cotización con respaldos", async () => {
    const { db } = createDemoDb((s) => setConfig(s, "costo_por_km", 200));
    const settings = await loadDeliverySettings(db);
    assert.equal(settings.quoteOptions.costPerKm, 200);
    assert.equal(settings.quoteOptions.radiusKm, 8);
    assert.ok(settings.zones.length >= 2);
    assert.equal(settings.config.modo_pausa, false);
  });
});
