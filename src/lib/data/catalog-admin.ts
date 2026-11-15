/**
 * Tanda 2 de la fase 2: ABM del catálogo (productos y categorías) en D1.
 * Solo staff (G9). Montos en centavos en la base; la API sigue hablando en
 * pesos y la conversión vive acá (productToApi / toCents).
 * Candado de Fudo igual que src/lib/fudo/catalog-lock.ts: en un producto con
 * fudo_id no se tocan name, precio, is_active ni category_id; en una
 * categoría con fudo_id no se toca el nombre. Los ítems de Fudo no se borran.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { assertCents, fromCents, toCents } from "./money.ts";
import { nowIso, type SqlDatabase, type SqlValue } from "./sql.ts";

export interface ProductDbRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  price_cents: number;
  image_url: string;
  is_active: number;
  /** 1 = el admin lo muestra en el portal del cliente. Lo maneja solo el admin (el sync de Fudo no lo toca). */
  show_in_portal: number;
  points_per_100: number | null;
  created_at: string;
  updated_at: string;
  fudo_id: number | null;
  source: string;
  fudo_synced_at: string | null;
}

export interface CategoryDbRow {
  id: string;
  name: string;
  description: string;
  is_active: number;
  points_per_100: number | null;
  created_at: string;
  updated_at: string;
  fudo_id: number | null;
  source: string;
  fudo_synced_at: string | null;
}

/** Forma que devuelve la API hoy (la de Supabase): precio en pesos y booleanos. */
export type ApiProduct = Omit<ProductDbRow, "price_cents" | "is_active" | "show_in_portal"> & {
  price: number;
  is_active: boolean;
  show_in_portal: boolean;
};
export type ApiCategory = Omit<CategoryDbRow, "is_active"> & { is_active: boolean };

export function productToApi(r: ProductDbRow): ApiProduct {
  const { price_cents, is_active, show_in_portal, ...rest } = r;
  return { ...rest, price: fromCents(price_cents), is_active: is_active === 1, show_in_portal: show_in_portal === 1 };
}

export function categoryToApi(r: CategoryDbRow): ApiCategory {
  const { is_active, ...rest } = r;
  return { ...rest, is_active: is_active === 1 };
}

/** Forma comparable para la lectura sombra (Supabase y D1 por igual). Sin timestamps: difieren por precisión. */
export function comparableProduct(p: { id: string; price: number | string; [k: string]: unknown }): Record<string, unknown> {
  return {
    id: p.id, category_id: p.category_id ?? null, name: p.name, description: p.description ?? "",
    price_cents: toCents(p.price), image_url: p.image_url ?? "", is_active: Boolean(p.is_active),
    points_per_100: p.points_per_100 == null ? null : Number(p.points_per_100), fudo_id: p.fudo_id ?? null,
  };
}

export function comparableCategory(c: { id: string; [k: string]: unknown }): Record<string, unknown> {
  return {
    id: c.id, name: c.name, description: c.description ?? "", is_active: Boolean(c.is_active),
    points_per_100: c.points_per_100 == null ? null : Number(c.points_per_100), fudo_id: c.fudo_id ?? null,
  };
}

const PRODUCT_COLS =
  "id, category_id, name, description, price_cents, image_url, is_active, show_in_portal, points_per_100, created_at, updated_at, fudo_id, source, fudo_synced_at";
const CATEGORY_COLS = "id, name, description, is_active, points_per_100, created_at, updated_at, fudo_id, source, fudo_synced_at";

export async function listAllProducts(db: SqlDatabase, actor: Actor): Promise<ApiProduct[]> {
  requireStaff(actor);
  const { results } = await db.prepare(`SELECT ${PRODUCT_COLS} FROM products ORDER BY created_at DESC`).all<ProductDbRow>();
  return results.map(productToApi);
}

export async function listAllCategories(db: SqlDatabase, actor: Actor): Promise<ApiCategory[]> {
  requireStaff(actor);
  const { results } = await db.prepare(`SELECT ${CATEGORY_COLS} FROM categories ORDER BY created_at ASC`).all<CategoryDbRow>();
  return results.map(categoryToApi);
}

async function getProduct(db: SqlDatabase, id: string): Promise<ProductDbRow | null> {
  return db.prepare(`SELECT ${PRODUCT_COLS} FROM products WHERE id = ?`).bind(id).first<ProductDbRow>();
}

async function getCategory(db: SqlDatabase, id: string): Promise<CategoryDbRow | null> {
  return db.prepare(`SELECT ${CATEGORY_COLS} FROM categories WHERE id = ?`).bind(id).first<CategoryDbRow>();
}

export interface ProductInput {
  name: string;
  description: string;
  price: number;
  image_url: string;
  category_id: string | null;
  is_active: boolean;
  /** Visible en el portal del cliente. Alta manual desde el admin: visible salvo que se pida lo contrario. */
  show_in_portal?: boolean;
  points_per_100: number | null;
}

export async function createProduct(db: SqlDatabase, actor: Actor, id: string, p: ProductInput): Promise<ApiProduct> {
  requireStaff(actor);
  const cents = assertCents(toCents(p.price), "price");
  await db
    .prepare(
      "INSERT INTO products (id, category_id, name, description, price_cents, image_url, is_active, show_in_portal, points_per_100) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, p.category_id, p.name, p.description, cents, p.image_url, p.is_active ? 1 : 0, p.show_in_portal === false ? 0 : 1, p.points_per_100)
    .run();
  const row = await getProduct(db, id);
  if (!row) throw new Error("Producto no creado");
  return productToApi(row);
}

const PRODUCT_FUDO_MANAGED = new Set(["name", "price", "is_active", "category_id"]);
/** Columnas editables (lista blanca): API → columna D1. */
const PRODUCT_EDITABLE: Record<string, string> = {
  name: "name", description: "description", price: "price_cents", image_url: "image_url",
  category_id: "category_id", is_active: "is_active", show_in_portal: "show_in_portal", points_per_100: "points_per_100",
};
const BOOL_COLUMNS = new Set(["is_active", "show_in_portal"]);

export type UpdateResult<T> = { status: "ok"; row: T; ignored: string[] } | { status: "not_found" } | { status: "fudo_locked"; ignored: string[] };

export async function updateProduct(db: SqlDatabase, actor: Actor, id: string, patch: Partial<ProductInput>): Promise<UpdateResult<ApiProduct>> {
  requireStaff(actor);
  const current = await getProduct(db, id);
  if (!current) return { status: "not_found" };
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const unknown = entries.filter(([k]) => !Object.hasOwn(PRODUCT_EDITABLE, k)).map(([k]) => k);
  if (unknown.length) throw new Error(`Campos no editables: ${unknown.join(", ")}`);
  const locked = current.fudo_id != null;
  const ignored = locked ? entries.filter(([k]) => PRODUCT_FUDO_MANAGED.has(k)).map(([k]) => k) : [];
  const kept = entries.filter(([k]) => !ignored.includes(k));
  if (kept.length === 0) return { status: "fudo_locked", ignored };

  const sets: string[] = [];
  const values: SqlValue[] = [];
  for (const [k, v] of kept) {
    sets.push(`${PRODUCT_EDITABLE[k]} = ?`);
    values.push(k === "price" ? assertCents(toCents(v as number), "price") : BOOL_COLUMNS.has(k) ? (v ? 1 : 0) : (v as SqlValue));
  }
  sets.push("updated_at = ?");
  values.push(nowIso());
  // Si el producto pasó a ser de Fudo entre la lectura y el UPDATE, no se aplica (fudo_id IS ? con el valor leído).
  await db.prepare(`UPDATE products SET ${sets.join(", ")} WHERE id = ? AND fudo_id IS ?`).bind(...values, id, current.fudo_id).run();
  const row = await getProduct(db, id);
  if (!row) return { status: "not_found" };
  return { status: "ok", row: productToApi(row), ignored };
}

export type DeleteResult = "ok" | "not_found" | "fudo_locked";

export async function deleteProduct(db: SqlDatabase, actor: Actor, id: string): Promise<DeleteResult> {
  requireStaff(actor);
  const current = await getProduct(db, id);
  if (!current) return "not_found";
  if (current.fudo_id != null) return "fudo_locked";
  const r = await db.prepare("DELETE FROM products WHERE id = ? AND fudo_id IS NULL").bind(id).run();
  return r.meta.changes === 1 ? "ok" : "fudo_locked";
}

export interface CategoryInput {
  name: string;
  description: string;
  is_active: boolean;
  points_per_100: number | null;
}

export async function createCategory(db: SqlDatabase, actor: Actor, id: string, c: CategoryInput): Promise<ApiCategory> {
  requireStaff(actor);
  await db
    .prepare("INSERT INTO categories (id, name, description, is_active, points_per_100) VALUES (?, ?, ?, ?, ?)")
    .bind(id, c.name, c.description, c.is_active ? 1 : 0, c.points_per_100)
    .run();
  const row = await getCategory(db, id);
  if (!row) throw new Error("Categoría no creada");
  return categoryToApi(row);
}

const CATEGORY_EDITABLE: Record<string, string> = {
  name: "name", description: "description", is_active: "is_active", points_per_100: "points_per_100",
};

export async function updateCategory(db: SqlDatabase, actor: Actor, id: string, patch: Partial<CategoryInput>): Promise<UpdateResult<ApiCategory>> {
  requireStaff(actor);
  const current = await getCategory(db, id);
  if (!current) return { status: "not_found" };
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const unknown = entries.filter(([k]) => !Object.hasOwn(CATEGORY_EDITABLE, k)).map(([k]) => k);
  if (unknown.length) throw new Error(`Campos no editables: ${unknown.join(", ")}`);
  const ignored = current.fudo_id != null ? entries.filter(([k]) => k === "name").map(([k]) => k) : [];
  const kept = entries.filter(([k]) => !ignored.includes(k));
  if (kept.length === 0) return { status: "fudo_locked", ignored };

  const sets: string[] = [];
  const values: SqlValue[] = [];
  for (const [k, v] of kept) {
    sets.push(`${CATEGORY_EDITABLE[k]} = ?`);
    values.push(k === "is_active" ? (v ? 1 : 0) : (v as SqlValue));
  }
  sets.push("updated_at = ?");
  values.push(nowIso());
  await db.prepare(`UPDATE categories SET ${sets.join(", ")} WHERE id = ? AND fudo_id IS ?`).bind(...values, id, current.fudo_id).run();
  const row = await getCategory(db, id);
  if (!row) return { status: "not_found" };
  return { status: "ok", row: categoryToApi(row), ignored };
}

/** Borra la categoría y deja sus productos sin categoría, en un batch atómico. */
export async function deleteCategory(db: SqlDatabase, actor: Actor, id: string): Promise<DeleteResult> {
  requireStaff(actor);
  const current = await getCategory(db, id);
  if (!current) return "not_found";
  if (current.fudo_id != null) return "fudo_locked";
  const [, del] = await db.batch([
    db.prepare("UPDATE products SET category_id = NULL, updated_at = ? WHERE category_id = ? AND EXISTS (SELECT 1 FROM categories WHERE id = ? AND fudo_id IS NULL)").bind(nowIso(), id, id),
    db.prepare("DELETE FROM categories WHERE id = ? AND fudo_id IS NULL").bind(id),
  ]);
  return del.meta.changes === 1 ? "ok" : "fudo_locked";
}
