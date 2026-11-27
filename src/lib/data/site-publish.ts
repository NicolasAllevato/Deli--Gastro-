/**
 * Datos de la publicación al sitio web (Etapa 2): productos de la app con su foto/estado, vínculos completos y el
 * historial de corridas (`site_publish_runs`, migración 0027). Solo staff (admin o crons con actor de sistema).
 * `PublishStore` es lo único que ve `lib/gambeta/publish.ts`: así el ejecutor se prueba con una base real en memoria.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export type PublishTrigger = "manual" | "cron" | "cambio";

export interface PublishAppProduct {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  isActive: boolean;
}

export interface PublishLink {
  appProductId: string;
  kind: "product" | "promotion";
  siteId: string;
  siteVariantId: string | null;
  pushedImageUrl: string | null;
  lastPushError: string | null;
}

export interface PushResult {
  appProductId: string;
  /** null = no cambia `last_pushed_at` (un error no cuenta como publicado). */
  pushedAt: string | null;
  error: string | null;
  /** undefined = no cambia la foto registrada. */
  pushedImageUrl?: string;
}

export interface PublishRun {
  id: string;
  trigger: PublishTrigger;
  startedAt: string;
  finishedAt: string | null;
  ok: boolean | null;
  summary: Record<string, unknown> | null;
}

export interface NewLink {
  appProductId: string;
  siteId: string;
  siteVariantId: string | null;
  linkedBy: string | null;
  pushedImageUrl: string | null;
  pushedAt: string;
}

export interface PublishStore {
  listAppProducts(ids?: readonly string[]): Promise<PublishAppProduct[]>;
  getAppProduct(id: string): Promise<(PublishAppProduct & { categoryName: string | null }) | null>;
  listLinks(): Promise<PublishLink[]>;
  recordPushes(results: readonly PushResult[]): Promise<void>;
  clearErrors(appProductIds: readonly string[]): Promise<void>;
  insertLink(link: NewLink): Promise<boolean>;
  hasRunningSince(sinceIso: string): Promise<boolean>;
  startRun(id: string, trigger: PublishTrigger, startedAt: string): Promise<void>;
  finishRun(id: string, ok: boolean, summary: Record<string, unknown>, finishedAt: string): Promise<void>;
  lastRun(): Promise<PublishRun | null>;
}

interface ProductRow { id: string; name: string; price_cents: number; image_url: string; is_active: number; category_name?: string | null }
interface LinkRow {
  app_product_id: string; kind: "product" | "promotion"; site_id: string; site_variant_id: string | null;
  pushed_image_url: string | null; last_push_error: string | null;
}
interface RunRow { id: string; trigger: PublishTrigger; started_at: string; finished_at: string | null; ok: number | null; summary: string | null }

const toProduct = (r: ProductRow): PublishAppProduct => ({
  id: r.id, name: r.name, priceCents: r.price_cents, imageUrl: (r.image_url ?? "").trim(), isActive: r.is_active === 1,
});

function parseSummary(raw: string | null): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createPublishStore(db: SqlDatabase, actor: Actor): PublishStore {
  requireStaff(actor);
  return {
    async listAppProducts(ids) {
      if (ids && ids.length === 0) return [];
      const { results } = ids
        ? await db
            .prepare("SELECT id, name, price_cents, image_url, is_active FROM products WHERE id IN (SELECT value FROM json_each(?))")
            .bind(JSON.stringify(ids))
            .all<ProductRow>()
        : await db.prepare("SELECT id, name, price_cents, image_url, is_active FROM products").all<ProductRow>();
      return results.map(toProduct);
    },

    async getAppProduct(id) {
      const r = await db
        .prepare(
          `SELECT p.id AS id, p.name AS name, p.price_cents AS price_cents, p.image_url AS image_url, p.is_active AS is_active,
                  c.name AS category_name
             FROM products p LEFT JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
        )
        .bind(id)
        .first<ProductRow>();
      return r ? { ...toProduct(r), categoryName: r.category_name ?? null } : null;
    },

    async listLinks() {
      const { results } = await db
        .prepare("SELECT app_product_id, kind, site_id, site_variant_id, pushed_image_url, last_push_error FROM site_links ORDER BY linked_at")
        .all<LinkRow>();
      return results.map((r) => ({
        appProductId: r.app_product_id, kind: r.kind, siteId: r.site_id, siteVariantId: r.site_variant_id,
        pushedImageUrl: r.pushed_image_url, lastPushError: r.last_push_error,
      }));
    },

    async recordPushes(results) {
      if (results.length === 0) return;
      await db.batch(
        results.map((r) =>
          db
            .prepare(
              `UPDATE site_links SET last_pushed_at = COALESCE(?, last_pushed_at), last_push_error = ?,
                      pushed_image_url = COALESCE(?, pushed_image_url) WHERE app_product_id = ?`,
            )
            .bind(r.pushedAt, r.error, r.pushedImageUrl ?? null, r.appProductId),
        ),
      );
    },

    async clearErrors(ids) {
      if (ids.length === 0) return;
      await db
        .prepare("UPDATE site_links SET last_push_error = NULL WHERE app_product_id IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(ids))
        .run();
    },

    async insertLink(l) {
      const r = await db
        .prepare(
          `INSERT OR IGNORE INTO site_links (app_product_id, kind, site_id, site_variant_id, linked_by, linked_at, last_pushed_at, pushed_image_url)
           VALUES (?, 'product', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(l.appProductId, l.siteId, l.siteVariantId, l.linkedBy, nowIso(), l.pushedAt, l.pushedImageUrl)
        .run();
      return r.meta.changes === 1;
    },

    async hasRunningSince(sinceIso) {
      const r = await db
        .prepare("SELECT COUNT(*) AS n FROM site_publish_runs WHERE finished_at IS NULL AND started_at > ?")
        .bind(sinceIso)
        .first<{ n: number }>();
      return (r?.n ?? 0) > 0;
    },

    async startRun(id, trigger, startedAt) {
      await db.prepare("INSERT INTO site_publish_runs (id, trigger, started_at) VALUES (?, ?, ?)").bind(id, trigger, startedAt).run();
    },

    async finishRun(id, ok, summary, finishedAt) {
      await db
        .prepare("UPDATE site_publish_runs SET finished_at = ?, ok = ?, summary = ? WHERE id = ?")
        .bind(finishedAt, ok ? 1 : 0, JSON.stringify(summary).slice(0, 4000), id)
        .run();
    },

    async lastRun() {
      const r = await db
        .prepare("SELECT id, trigger, started_at, finished_at, ok, summary FROM site_publish_runs ORDER BY started_at DESC LIMIT 1")
        .first<RunRow>();
      return r
        ? { id: r.id, trigger: r.trigger, startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === null ? null : r.ok === 1, summary: parseSummary(r.summary) }
        : null;
    },
  };
}
