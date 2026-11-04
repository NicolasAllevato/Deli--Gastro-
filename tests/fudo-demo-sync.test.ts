import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb } from "./helpers/demo-db.ts";

const { runDemoCatalogSync } = await import("../src/lib/fudo/demo-sync.ts");
const { resetDemoFudo, simulateFudoChange, demoFudoProductsPayload } = await import("../src/lib/demo/fudo-fixture.ts");

const byName = (rows: Array<Record<string, unknown>>, name: string) => rows.find((r) => r.name === name);

describe("Fudo en el modo demo", () => {
  beforeEach(() => resetDemoFudo());

  it("el seed trae productos vinculados a Fudo y otros manuales, con su mapeo", () => {
    const { store } = createDemoDb();
    const linked = store.products.filter((p) => p.source === "fudo");
    const manual = store.products.filter((p) => p.source !== "fudo");
    assert.ok(linked.length >= 6, "hay productos vinculados");
    assert.ok(manual.length >= 3, "hay productos manuales para ver el vínculo por nombre");
    assert.ok(linked.every((p) => typeof p.fudo_id === "number"));
    assert.equal(store.fudo_product_map.length, linked.length);
    assert.equal(store.fudo_payment_map.length, 3);
  });

  it("el simulacro no escribe nada", async () => {
    const { db, store } = createDemoDb();
    const before = JSON.stringify(store.products);
    const summary = await runDemoCatalogSync(db, true);
    assert.equal(summary.dryRun, true);
    assert.ok(summary.productsCreated > 0 && summary.productsUpdated > 0);
    assert.equal(JSON.stringify(store.products), before);
  });

  it("la primera sincronización trae precios nuevos, crea productos, vincula por nombre y ignora modificadores", async () => {
    const { db, store } = createDemoDb();
    const summary = await runDemoCatalogSync(db, false);
    assert.equal(summary.productsCreated, 2);

    assert.equal(byName(store.products, "Pizza Margarita")?.price, 12900);
    assert.equal(byName(store.products, "Hamburguesa Doble BBQ")?.price, 11900);
    assert.ok(byName(store.products, "Hamburguesa Bacon"), "producto nuevo de Fudo");
    assert.ok(byName(store.products, "Pizza Fugazzeta"), "producto nuevo de Fudo");
    assert.equal(byName(store.products, "Extra cheddar"), undefined, "los modificadores no son platos");

    const papas = byName(store.products, "Papas Fritas con Cheddar");
    assert.equal(papas?.source, "fudo");
    assert.equal(typeof papas?.fudo_id, "number");
    assert.equal(byName(store.categories, "Acompañamientos")?.source, "fudo");
    assert.equal(byName(store.categories, "Opciones"), undefined);
    assert.equal(store.fudo_product_map.length, store.products.filter((p) => p.fudo_id != null).length);
  });

  it("no pisa foto ni descripción de lo que ya existía", async () => {
    const { db, store } = createDemoDb();
    const before = byName(store.products, "Pizza Margarita");
    const image = before?.image_url;
    const description = before?.description;
    await runDemoCatalogSync(db, false);
    const after = byName(store.products, "Pizza Margarita");
    assert.equal(after?.image_url, image);
    assert.equal(after?.description, description);
  });

  it("es idempotente: una segunda corrida no cambia nada", async () => {
    const { db } = createDemoDb();
    await runDemoCatalogSync(db, false);
    const again = await runDemoCatalogSync(db, false);
    assert.deepEqual(
      [again.categoriesCreated, again.categoriesUpdated, again.productsCreated, again.productsUpdated, again.productsDeactivated],
      [0, 0, 0, 0, 0],
    );
  });

  it("un cambio de precios en el Fudo simulado llega a la app con la siguiente sincronización", async () => {
    const { db, store } = createDemoDb();
    await runDemoCatalogSync(db, false);
    const priceBefore = Number(byName(store.products, "Hamburguesa Clásica")?.price);
    const change = simulateFudoChange("precios");
    assert.match(change.message, /precio/i);
    const summary = await runDemoCatalogSync(db, false);
    assert.ok(summary.productsUpdated > 0);
    assert.ok(Number(byName(store.products, "Hamburguesa Clásica")?.price) > priceBefore);
  });

  it("un producto apagado en Fudo se desactiva en la app (no se borra)", async () => {
    const { db, store } = createDemoDb();
    await runDemoCatalogSync(db, false);
    const activeBefore = store.products.filter((p) => p.is_active).length;
    simulateFudoChange("apagar");
    const summary = await runDemoCatalogSync(db, false);
    assert.equal(summary.productsUpdated, 1);
    assert.equal(store.products.filter((p) => p.is_active).length, activeBefore - 1);
  });

  it("un producto nuevo en el Fudo simulado se crea en la app", async () => {
    const { db, store } = createDemoDb();
    await runDemoCatalogSync(db, false);
    const total = store.products.length;
    simulateFudoChange("nuevo");
    const summary = await runDemoCatalogSync(db, false);
    assert.equal(summary.productsCreated, 1);
    assert.equal(store.products.length, total + 1);
  });

  it("el payload del Fudo simulado tiene la forma de la API real (JSON:API)", () => {
    const payload = demoFudoProductsPayload() as { data: Array<{ type: string; attributes: { name: string }; relationships: unknown }> };
    assert.ok(payload.data.length > 10);
    assert.equal(payload.data[0].type, "Product");
    assert.equal(typeof payload.data[0].attributes.name, "string");
    assert.ok(payload.data[0].relationships);
  });
});
