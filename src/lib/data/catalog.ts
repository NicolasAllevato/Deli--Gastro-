import { isStaff, ForbiddenError, requireStaff, type Actor } from "./actor.ts";
import { assertCents } from "./money.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export interface ProductRow {
  id: string;
  category_id: string | null;
  name: string;
  description: string;
  price_cents: number;
  image_url: string;
  is_active: number;
}

/** G9: lectura pública. Anónimos y clientes ven solo lo activo; staff ve todo. */
export async function listProducts(db: SqlDatabase, actor: Actor): Promise<ProductRow[]> {
  const where = isStaff(actor) ? "" : "WHERE is_active = 1";
  const { results } = await db
    .prepare(`SELECT id, category_id, name, description, price_cents, image_url, is_active FROM products ${where} ORDER BY name`)
    .all<ProductRow>();
  return results;
}

export async function listCategories(db: SqlDatabase, actor: Actor): Promise<{ id: string; name: string; is_active: number }[]> {
  const where = isStaff(actor) ? "" : "WHERE is_active = 1";
  return (await db.prepare(`SELECT id, name, is_active FROM categories ${where} ORDER BY name`).all<{ id: string; name: string; is_active: number }>()).results;
}

/** G9: escritura solo admin (rol de la sesión del servidor). */
export async function upsertProduct(
  db: SqlDatabase,
  actor: Actor,
  p: { id: string; categoryId: string | null; name: string; description?: string; priceCents: number; isActive?: boolean },
): Promise<void> {
  requireStaff(actor);
  assertCents(p.priceCents, "price_cents");
  await db
    .prepare(
      `INSERT INTO products (id, category_id, name, description, price_cents, is_active) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET category_id = excluded.category_id, name = excluded.name,
         description = excluded.description, price_cents = excluded.price_cents, is_active = excluded.is_active, updated_at = ?`,
    )
    .bind(p.id, p.categoryId, p.name, p.description ?? "", p.priceCents, p.isActive === false ? 0 : 1, nowIso())
    .run();
}

export async function upsertCategory(db: SqlDatabase, actor: Actor, c: { id: string; name: string; isActive?: boolean }): Promise<void> {
  requireStaff(actor);
  await db
    .prepare(
      `INSERT INTO categories (id, name, is_active) VALUES (?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, is_active = excluded.is_active, updated_at = ?`,
    )
    .bind(c.id, c.name, c.isActive === false ? 0 : 1, nowIso())
    .run();
}

/** G8: global_config lectura pública; escritura solo staff. */
export async function getConfig(db: SqlDatabase, _actor: Actor, key: string): Promise<unknown> {
  const row = await db.prepare("SELECT value FROM global_config WHERE key = ?").bind(key).first<{ value: string }>();
  return row ? JSON.parse(row.value) : null;
}

/** Toda la configuración (panel admin). */
export async function listConfig(db: SqlDatabase, actor: Actor): Promise<{ key: string; value: unknown }[]> {
  requireStaff(actor);
  const { results } = await db.prepare("SELECT key, value FROM global_config ORDER BY key").all<{ key: string; value: string }>();
  return results.map((r) => ({ key: r.key, value: JSON.parse(r.value) }));
}

/** Escritura de varias claves en un batch atómico. */
export async function setConfigMany(db: SqlDatabase, actor: Actor, rows: { key: string; value: unknown }[]): Promise<void> {
  requireStaff(actor);
  if (rows.length === 0) return;
  const now = nowIso();
  await db.batch(
    rows.map((r) =>
      db
        .prepare("INSERT INTO global_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
        .bind(r.key, JSON.stringify(r.value), now),
    ),
  );
}

export async function setConfig(db: SqlDatabase, actor: Actor, key: string, value: unknown): Promise<void> {
  requireStaff(actor);
  await db
    .prepare("INSERT INTO global_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
    .bind(key, JSON.stringify(value), nowIso())
    .run();
}

/** G10 (endurecido a pedido del auditor): reports_daily solo admin/sistema. */
export async function listDailyReports(db: SqlDatabase, actor: Actor, fromDay: string, toDay: string) {
  if (!isStaff(actor)) throw new ForbiddenError();
  return (
    await db
      .prepare("SELECT report_date, total_income_cents, total_orders, orders_cancelled FROM reports_daily WHERE report_date BETWEEN ? AND ? ORDER BY report_date")
      .bind(fromDay, toDay)
      .all<{ report_date: string; total_income_cents: number; total_orders: number; orders_cancelled: number }>()
  ).results;
}
