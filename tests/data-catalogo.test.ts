/**
 * Fase 2, tanda 2: ABM del catálogo en D1 (solo staff, centavos, candado de Fudo)
 * y dualWrite con shouldMirror / modo d1.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as cat from "../src/lib/data/catalog-admin.ts";
import { dualWrite, compareRows } from "../src/lib/data/shadow.ts";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const base = { name: "Fugazza", description: "", price: 12500.5, image_url: "", category_id: "cat-1", is_active: true, points_per_100: null };

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
  db.raw.prepare("INSERT INTO categories (id, name, fudo_id, source) VALUES ('cat-fudo', 'Fudo', 77, 'fudo')").run();
  db.raw.prepare("INSERT INTO products (id, category_id, name, price_cents, fudo_id, source) VALUES ('p-fudo', 'cat-fudo', 'De Fudo', 990000, 55, 'fudo')").run();
});

describe("catálogo admin: autorización (G9)", () => {
  it("cliente, repartidor y anon no leen ni escriben el catálogo completo", async () => {
    for (const a of [actors.anon, actors.ana, actors.rep1]) {
      await assert.rejects(cat.listAllProducts(db, a), ForbiddenError);
      await assert.rejects(cat.createProduct(db, a, UUID(1), base), ForbiddenError);
      await assert.rejects(cat.updateProduct(db, a, "p-on", { name: "x" }), ForbiddenError);
      await assert.rejects(cat.deleteProduct(db, a, "p-on"), ForbiddenError);
      await assert.rejects(cat.createCategory(db, a, UUID(2), { name: "x", description: "", is_active: true, points_per_100: null }), ForbiddenError);
      await assert.rejects(cat.deleteCategory(db, a, "cat-1"), ForbiddenError);
    }
  });
});

describe("productos", () => {
  it("alta en centavos y lectura en pesos", async () => {
    const p = await cat.createProduct(db, actors.admin, UUID(1), base);
    assert.equal(p.price, 12500.5);
    assert.equal(p.is_active, true);
    const raw = db.raw.prepare("SELECT price_cents FROM products WHERE id = ?").get(UUID(1)) as { price_cents: number };
    assert.equal(raw.price_cents, 1250050);
    assert.ok((await cat.listAllProducts(db, actors.admin)).some((x) => x.id === UUID(1)));
  });
  it("edición parcial no pisa otros campos", async () => {
    db.raw.prepare("UPDATE products SET description = 'rica', image_url = 'https://x/i.png' WHERE id = 'p-on'").run();
    const r = await cat.updateProduct(db, actors.admin, "p-on", { is_active: false, price: 100 });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.equal(r.row.description, "rica");
    assert.equal(r.row.image_url, "https://x/i.png");
    assert.equal(r.row.price, 100);
    assert.equal(r.row.is_active, false);
  });
  it("producto de Fudo: ignora nombre/precio/estado/categoría y acepta foto", async () => {
    const r = await cat.updateProduct(db, actors.admin, "p-fudo", { name: "otro", price: 1, image_url: "https://x/f.png" });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(r.ignored.sort(), ["name", "price"]);
    assert.equal(r.row.name, "De Fudo");
    assert.equal(r.row.price, 9900);
    assert.equal(r.row.image_url, "https://x/f.png");
    const only = await cat.updateProduct(db, actors.admin, "p-fudo", { name: "otro" });
    assert.deepEqual(only, { status: "fudo_locked", ignored: ["name"] });
  });
  it("campos fuera de la lista blanca se rechazan", async () => {
    await assert.rejects(cat.updateProduct(db, actors.admin, "p-on", { fudo_id: 1 } as never));
    await assert.rejects(cat.updateProduct(db, actors.admin, "p-on", { "name = 'x', price_cents": 1 } as never));
  });
  it("inexistente → not_found; borrar: manual sí, Fudo no", async () => {
    assert.deepEqual(await cat.updateProduct(db, actors.admin, "nada", { name: "x" }), { status: "not_found" });
    assert.equal(await cat.deleteProduct(db, actors.admin, "p-fudo"), "fudo_locked");
    assert.equal(await cat.deleteProduct(db, actors.admin, "p-off"), "ok");
    assert.equal(await cat.deleteProduct(db, actors.admin, "p-off"), "not_found");
  });
  it("precio con más de 2 decimales se redondea a centavos", async () => {
    const p = await cat.createProduct(db, actors.admin, UUID(3), { ...base, price: 10.005 });
    assert.equal(p.price, 10.01);
  });
});

describe("categorías", () => {
  it("alta, edición y candado de nombre en Fudo", async () => {
    const c = await cat.createCategory(db, actors.admin, UUID(4), { name: "Postres", description: "", is_active: true, points_per_100: 2 });
    assert.equal(c.is_active, true);
    const r = await cat.updateCategory(db, actors.admin, "cat-fudo", { name: "x", is_active: false });
    assert.equal(r.status, "ok");
    if (r.status === "ok") {
      assert.deepEqual(r.ignored, ["name"]);
      assert.equal(r.row.name, "Fudo");
      assert.equal(r.row.is_active, false);
    }
  });
  it("borrar deja los productos sin categoría, atómico; Fudo no se borra", async () => {
    assert.equal(await cat.deleteCategory(db, actors.admin, "cat-fudo"), "fudo_locked");
    assert.equal(await cat.deleteCategory(db, actors.admin, "cat-1"), "ok");
    const n = db.raw.prepare("SELECT count(*) n FROM products WHERE category_id = 'cat-1'").get() as { n: number };
    assert.equal(n.n, 0);
    const p = db.raw.prepare("SELECT category_id FROM products WHERE id = 'p-on'").get() as { category_id: string | null };
    assert.equal(p.category_id, null);
  });
});

describe("comparación Supabase vs D1", () => {
  it("la misma fila en pesos (Supabase) y en D1 no genera diferencias", async () => {
    const d1 = await cat.createProduct(db, actors.admin, UUID(5), base);
    const supa = { ...d1, price: "12500.50", created_at: "otro", updated_at: "otro" };
    assert.equal(await compareRows("t", [cat.comparableProduct(supa)], [cat.comparableProduct(d1)], (r) => String(r.id)), null);
  });
});

describe("dualWrite con shouldMirror y modo d1", () => {
  it("dual: un 404/409 de Supabase no se refleja en D1", async () => {
    let mirrored = false;
    const r = await dualWrite("t", async () => ({ status: 409, body: {} }), async () => { mirrored = true; return { status: 200, body: {} }; }, {
      backend: "dual", shouldMirror: (o) => o.status < 300,
    });
    assert.equal(r?.status, 409);
    assert.equal(mirrored, false);
  });
  it("d1: la respuesta es la de D1", async () => {
    const r = await dualWrite("t", async () => ({ status: 500, body: "no" }), async () => ({ status: 201, body: "d1" }), { backend: "d1" });
    assert.deepEqual(r, { status: 201, body: "d1" });
  });
});
