/**
 * Vínculos producto de la app ↔ producto/promoción del sitio web (tabla D1 `site_links`, migración 0026).
 * Solo staff. Varios productos de la app pueden apuntar al mismo producto del sitio (uno por variante).
 */
import { requireStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export interface SiteLink {
  appProductId: string;
  kind: "product" | "promotion";
  siteId: string;
  siteVariantId: string | null;
  linkedBy: string | null;
  linkedAt: string;
  lastPushedAt: string | null;
  lastPushError: string | null;
}

export interface SiteLinkInput {
  appProductId: string;
  kind: "product" | "promotion";
  siteId: string;
  siteVariantId: string | null;
}

export interface AppProductRow {
  id: string;
  name: string;
  categoryName: string | null;
  price: number;
  hasPhoto: boolean;
}

export class SiteLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SiteLinkError";
  }
}

interface LinkDbRow {
  app_product_id: string;
  kind: "product" | "promotion";
  site_id: string;
  site_variant_id: string | null;
  linked_by: string | null;
  linked_at: string;
  last_pushed_at: string | null;
  last_push_error: string | null;
}

const toLink = (r: LinkDbRow): SiteLink => ({
  appProductId: r.app_product_id,
  kind: r.kind,
  siteId: r.site_id,
  siteVariantId: r.site_variant_id,
  linkedBy: r.linked_by,
  linkedAt: r.linked_at,
  lastPushedAt: r.last_pushed_at,
  lastPushError: r.last_push_error,
});

export async function listSiteLinks(db: SqlDatabase, actor: Actor): Promise<SiteLink[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(
      "SELECT app_product_id, kind, site_id, site_variant_id, linked_by, linked_at, last_pushed_at, last_push_error FROM site_links ORDER BY linked_at",
    )
    .all<LinkDbRow>();
  return results.map(toLink);
}

/** Productos activos de la app (los que se publican), con su categoría y si ya tienen foto. */
export async function listAppProductsForSite(db: SqlDatabase, actor: Actor): Promise<AppProductRow[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(
      `SELECT p.id AS id, p.name AS name, c.name AS category_name, p.price_cents AS price_cents, p.image_url AS image_url
         FROM products p LEFT JOIN categories c ON c.id = p.category_id
        WHERE p.is_active = 1
        ORDER BY c.name, p.name`,
    )
    .all<{ id: string; name: string; category_name: string | null; price_cents: number; image_url: string }>();
  return results.map((r) => ({
    id: r.id,
    name: r.name,
    categoryName: r.category_name,
    price: r.price_cents / 100,
    hasPhoto: r.image_url.trim() !== "",
  }));
}

/**
 * Guarda vínculos en un solo lote. `siteId: null` quita el vínculo del producto.
 * Falla entera (sin guardar nada) si algún producto de la app no existe.
 */
export async function saveSiteLinks(
  db: SqlDatabase,
  actor: Actor,
  changes: ReadonlyArray<{ appProductId: string; link: Omit<SiteLinkInput, "appProductId"> | null }>,
  linkedBy: string | null,
): Promise<{ saved: number; removed: number }> {
  requireStaff(actor);
  if (changes.length === 0) return { saved: 0, removed: 0 };
  const ids = [...new Set(changes.map((c) => c.appProductId))];
  const { results } = await db
    .prepare("SELECT id FROM products WHERE id IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(ids))
    .all<{ id: string }>();
  const existing = new Set(results.map((r) => r.id));
  const missing = ids.filter((id) => !existing.has(id));
  if (missing.length > 0) throw new SiteLinkError("Alguno de los productos de la app ya no existe. Recargá la pantalla.");

  const now = nowIso();
  let saved = 0;
  let removed = 0;
  const statements = changes.map(({ appProductId, link }) => {
    if (!link) {
      removed++;
      return db.prepare("DELETE FROM site_links WHERE app_product_id = ?").bind(appProductId);
    }
    saved++;
    return db
      .prepare(
        `INSERT INTO site_links (app_product_id, kind, site_id, site_variant_id, linked_by, linked_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(app_product_id) DO UPDATE SET kind = excluded.kind, site_id = excluded.site_id,
           site_variant_id = excluded.site_variant_id, linked_by = excluded.linked_by, linked_at = excluded.linked_at,
           last_pushed_at = NULL, last_push_error = NULL, pushed_image_url = NULL`,
      )
      .bind(appProductId, link.kind, link.siteId, link.siteVariantId, linkedBy, now);
  });
  await db.batch(statements);
  return { saved, removed };
}

export async function removeSiteLink(db: SqlDatabase, actor: Actor, appProductId: string): Promise<boolean> {
  requireStaff(actor);
  const r = await db.prepare("DELETE FROM site_links WHERE app_product_id = ?").bind(appProductId).run();
  return r.meta.changes === 1;
}

/** Guarda la foto solo si el producto sigue sin ninguna (nunca pisa una existente). */
export async function setProductPhotoIfEmpty(db: SqlDatabase, actor: Actor, productId: string, url: string): Promise<boolean> {
  requireStaff(actor);
  const r = await db
    .prepare("UPDATE products SET image_url = ? WHERE id = ? AND TRIM(image_url) = ''")
    .bind(url, productId)
    .run();
  return r.meta.changes === 1;
}

/** Guarda cuál es la última foto de la app que el sitio ya tiene (la que se trajo del sitio o la que se mandó). */
export async function setPushedImage(db: SqlDatabase, actor: Actor, appProductId: string, url: string): Promise<boolean> {
  requireStaff(actor);
  const r = await db.prepare("UPDATE site_links SET pushed_image_url = ? WHERE app_product_id = ?").bind(url, appProductId).run();
  return r.meta.changes === 1;
}
