import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

const { saveCourierLocation, listCourierLocations, clearCourierLocation, locationSchema, LOCATION_STALE_MS } = await import(
  "../src/lib/courier-location.ts"
);

const USER = "11111111-0000-4000-8000-000000000000";

describe("ubicación del repartidor", () => {
  it("guarda una sola fila por repartidor y la pisa con la última posición", async () => {
    const demo = createDemoDb();
    assert.equal(await saveCourierLocation(demo.db, USER, "Juan", { lat: -34.6, lng: -58.4, accuracy: 12 }), null);
    assert.equal(await saveCourierLocation(demo.db, USER, "Juan", { lat: -34.61, lng: -58.41 }), null);
    assert.equal(demo.store.courier_locations.length, 1);

    const [loc] = await listCourierLocations(demo.db);
    assert.equal(loc?.courierName, "Juan");
    assert.equal(loc?.lat, -34.61);
    assert.equal(loc?.accuracy, null);
  });

  it("no muestra posiciones viejas y se borra al terminar", async () => {
    const demo = createDemoDb();
    await saveCourierLocation(demo.db, USER, "Juan", { lat: -34.6, lng: -58.4 });
    const later = new Date(Date.now() + LOCATION_STALE_MS + 60_000);
    assert.deepEqual(await listCourierLocations(demo.db, later), []);

    await clearCourierLocation(demo.db, USER);
    assert.equal(demo.store.courier_locations.length, 0);
  });

  it("valida coordenadas", () => {
    assert.ok(locationSchema.safeParse({ lat: -34.6, lng: -58.4, heading: null }).success);
    assert.equal(locationSchema.safeParse({ lat: 91, lng: 0 }).success, false);
    assert.equal(locationSchema.safeParse({ lat: 0, lng: Number.NaN }).success, false);
    assert.equal(locationSchema.safeParse({ lat: "0", lng: 0 }).success, false);
  });
});
