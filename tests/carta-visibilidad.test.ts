/**
 * Carta de Fudo con interruptor "Visible en el portal" y fotos por producto (migración D1 0009).
 * - El sync de Fudo crea los productos nuevos ocultos y no pisa visibilidad, foto ni descripción.
 * - La lectura pública solo devuelve lo activo y visible.
 * - El interruptor y la foto se guardan solo con autorización de admin, incluso en productos de Fudo.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import * as cat from "../src/lib/data/catalog-admin.ts";
import { listProducts } from "../src/lib/data/catalog.ts";
import { isPortalVisible } from "../src/lib/catalog/visibility.ts";
import { planCatalogSync, type ExistingProduct } from "../workers/fudo-gateway/src/catalog.ts";
import { applyPlan } from "../workers/fudo-gateway/src/catalog-sync.ts";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PHOTO = "https://pub-test.r2.dev/productos/a.webp";

let db: ReturnType<typeof createTestDb>;
const env = () => ({ SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k", DATA_BACKEND: "d1", DB: db });

type Row = { id: string; name: string; price_cents: number; is_active: number; show_in_portal: number; image_url: string; description: string; fudo_id: number | null };
const product = (where: string, ...args: (string | number)[]) =>
  db.raw.prepare(`SELECT id, name, price_cents, is_active, show_in_portal, image_url, description, fudo_id FROM products WHERE ${where}`).get(...args) as Row | undefined;

async function existing(): Promise<ExistingProduct[]> {
  const rows = db.raw.prepare("SELECT id, name, fudo_id, price_cents, is_active, category_id FROM products").all() as Array<{
    id: string; name: string; fudo_id: number | null; price_cents: number; is_active: number; category_id: string | null;
  }>;
  return rows.map((r) => ({ id: r.id, name: r.name, fudo_id: r.fudo_id, price: r.price_cents / 100, is_active: r.is_active === 1, category_id: r.category_id }));
}

async function runSync(fudoProducts: Array<{ id: number; name: string; price: number; active?: boolean }>): Promise<void> {
  const products = await existing();
  const categories = db.raw.prepare("SELECT id, name, fudo_id FROM categories").all() as Array<{ id: string; name: string; fudo_id: number | null }>;
  const plan = planCatalogSync({
    fudoCategories: [],
    fudoProducts: fudoProducts.map((p) => ({ id: p.id, name: p.name, price: p.price, active: p.active ?? true, categoryId: null, sellAlone: true })),
    categories: categories.map((c) => ({ ...c })),
    products,
  });
  await applyPlan(env(), plan, products);
}

beforeEach(() => {
  db = createTestDb();
  seed(db);
});

describe("migración 0009: show_in_portal", () => {
  it("un producto insertado sin la columna queda oculto (default 0)", () => {
    db.raw.prepare("INSERT INTO products (id, name, price_cents) VALUES ('p-x', 'X', 100)").run();
    assert.equal(product("id = 'p-x'")?.show_in_portal, 0);
  });
});

describe("sync de Fudo → D1", () => {
  it("crea los productos nuevos ocultos en el portal", async () => {
    await runSync([{ id: 501, name: "Pizza Fudo", price: 9000 }]);
    const p = product("fudo_id = 501");
    assert.ok(p, "se creó el producto");
    assert.equal(p.is_active, 1);
    assert.equal(p.show_in_portal, 0);
  });

  it("no pisa visibilidad, foto ni descripción del admin al actualizar nombre y precio", async () => {
    await runSync([{ id: 501, name: "Pizza Fudo", price: 9000 }]);
    const id = product("fudo_id = 501")!.id;
    const r = await cat.updateProduct(db, actors.admin, id, { show_in_portal: true, image_url: PHOTO, description: "Con rúcula" });
    assert.equal(r.status, "ok");

    await runSync([{ id: 501, name: "Pizza Fudo Grande", price: 9900 }]);
    const after = product("id = ?", id)!;
    assert.equal(after.name, "Pizza Fudo Grande");
    assert.equal(after.price_cents, 990000);
    assert.equal(after.show_in_portal, 1);
    assert.equal(after.image_url, PHOTO);
    assert.equal(after.description, "Con rúcula");
  });

  it("al desactivar desde Fudo no toca el interruptor del admin", async () => {
    await runSync([{ id: 501, name: "A", price: 1 }, { id: 502, name: "B", price: 1 }]);
    const id = product("fudo_id = 501")!.id;
    await cat.updateProduct(db, actors.admin, id, { show_in_portal: true });
    await runSync([{ id: 501, name: "A", price: 1, active: false }, { id: 502, name: "B", price: 1 }]);
    const after = product("id = ?", id)!;
    assert.equal(after.is_active, 0);
    assert.equal(after.show_in_portal, 1);
  });

  it("vincular un producto manual existente por nombre conserva su visibilidad y su foto", async () => {
    await cat.updateProduct(db, actors.admin, "p-on", { image_url: PHOTO });
    await runSync([{ id: 600, name: "Muzza", price: 12000 }]);
    const after = product("id = 'p-on'")!;
    assert.equal(after.fudo_id, 600);
    assert.equal(after.show_in_portal, 1);
    assert.equal(after.image_url, PHOTO);
  });
});

describe("lectura pública", () => {
  it("anónimos y clientes ven solo lo activo y visible; staff ve todo", async () => {
    db.raw.prepare("INSERT INTO products (id, name, price_cents, is_active, show_in_portal) VALUES ('p-hidden', 'Nueva de Fudo', 100, 1, 0)").run();
    for (const a of [actors.anon, actors.ana]) {
      const ids = (await listProducts(db, a)).map((p) => p.id);
      assert.deepEqual(ids, ["p-on"]);
    }
    const staff = (await listProducts(db, actors.admin)).map((p) => p.id).sort();
    assert.deepEqual(staff, ["p-hidden", "p-off", "p-on"]);
  });

  it("isPortalVisible: inactivo u oculto no se ve; sin la columna (Supabase) cuenta como visible", () => {
    assert.equal(isPortalVisible({ is_active: true, show_in_portal: true }), true);
    assert.equal(isPortalVisible({ is_active: true, show_in_portal: false }), false);
    assert.equal(isPortalVisible({ is_active: false, show_in_portal: true }), false);
    assert.equal(isPortalVisible({ is_active: 1, show_in_portal: 0 }), false);
    assert.equal(isPortalVisible({ is_active: true }), true);
  });
});

describe("interruptor y foto desde el admin", () => {
  beforeEach(() => {
    db.raw.prepare("INSERT INTO products (id, name, price_cents, fudo_id, source) VALUES ('p-fudo', 'De Fudo', 990000, 55, 'fudo')").run();
  });

  it("solo staff cambia visibilidad o foto", async () => {
    for (const a of [actors.anon, actors.ana, actors.rep1]) {
      await assert.rejects(cat.updateProduct(db, a, "p-fudo", { show_in_portal: true }), ForbiddenError);
      await assert.rejects(cat.updateProduct(db, a, "p-fudo", { image_url: PHOTO }), ForbiddenError);
    }
    assert.equal(product("id = 'p-fudo'")!.show_in_portal, 0);
  });

  it("en un producto de Fudo el admin prende la visibilidad y guarda la foto (no son campos de Fudo)", async () => {
    const r = await cat.updateProduct(db, actors.admin, "p-fudo", { show_in_portal: true, image_url: PHOTO, name: "Otro" });
    assert.equal(r.status, "ok");
    if (r.status !== "ok") return;
    assert.deepEqual(r.ignored, ["name"]);
    assert.equal(r.row.show_in_portal, true);
    assert.equal(r.row.image_url, PHOTO);
    assert.equal(r.row.name, "De Fudo");
  });

  it("quitar la foto la deja vacía y ocultar vuelve a 0", async () => {
    await cat.updateProduct(db, actors.admin, "p-on", { image_url: PHOTO });
    const r = await cat.updateProduct(db, actors.admin, "p-on", { image_url: "", show_in_portal: false });
    assert.equal(r.status, "ok");
    const after = product("id = 'p-on'")!;
    assert.equal(after.image_url, "");
    assert.equal(after.show_in_portal, 0);
  });

  it("alta manual: visible por defecto, oculta si se pide", async () => {
    const base = { name: "Flan", description: "", price: 10, image_url: "", category_id: "cat-1", is_active: true, points_per_100: null };
    assert.equal((await cat.createProduct(db, actors.admin, UUID(1), base)).show_in_portal, true);
    assert.equal((await cat.createProduct(db, actors.admin, UUID(2), { ...base, show_in_portal: false })).show_in_portal, false);
  });
});
