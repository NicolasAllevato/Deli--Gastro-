import {
  parseFudoCategories,
  parseFudoProducts,
  planCatalogSync,
  type CatalogPlan,
  type ExistingCategory,
  type ExistingProduct,
} from "./catalog";
import { rest, type DbEnv } from "./db";
import { listFudoCategories, listFudoProducts, type FudoEnv } from "./fudo";

export interface CatalogSyncSummary {
  categoriesCreated: number;
  categoriesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  productsDeactivated: number;
  /** Desactivaciones frenadas por el guardarraíl (listado de Fudo sospechosamente corto). */
  deactivationBlocked: number;
  /** true = solo se calculó el plan (modo prueba): no se escribió nada en la base. */
  dryRun: boolean;
}

const MERGE = { prefer: "return=representation,resolution=merge-duplicates" };
const idList = (ids: string[]): string => ids.map((id) => encodeURIComponent(id)).join(",");
/** UUID en la URL de PostgREST: 40 por pedido mantiene la URL muy por debajo de los ~8 KB que suelen rechazar los proxies. */
const ID_BATCH = 40;
// Insertar con merge por fudo_id: si el cron y el botón corren a la vez, la segunda escritura actualiza en vez de chocar con el unique.
const UPSERT_BY_FUDO_ID = "?on_conflict=fudo_id";
const chunk = <T,>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size));

async function loadState(env: DbEnv): Promise<{ categories: ExistingCategory[]; products: ExistingProduct[] }> {
  const [categories, products] = await Promise.all([
    rest<ExistingCategory[]>(env, "categories?select=id,name,fudo_id"),
    rest<Array<Omit<ExistingProduct, "price"> & { price: number | string }>>(env, "products?select=id,name,fudo_id,price,is_active,category_id"),
  ]);
  return { categories, products: products.map((p) => ({ ...p, price: Number(p.price) })) };
}

/** Aplica el plan: categorías primero (los productos las referencian), después productos, desactivados y mapeo. */
async function applyPlan(env: DbEnv, plan: CatalogPlan, existing: ExistingProduct[]): Promise<void> {
  const stamp = new Date().toISOString();
  const fudoCols = { source: "fudo", fudo_synced_at: stamp };

  if (plan.categoryInserts.length) {
    await rest(env, `categories${UPSERT_BY_FUDO_ID}`, { method: "POST", headers: MERGE, body: JSON.stringify(plan.categoryInserts.map((c) => ({ ...c, ...fudoCols }))) });
  }
  if (plan.categoryUpdates.length) {
    await rest(env, "categories?on_conflict=id", { method: "POST", headers: MERGE, body: JSON.stringify(plan.categoryUpdates.map((c) => ({ ...c, ...fudoCols }))) });
  }

  const cats = await rest<Array<{ id: string; fudo_id: number | null }>>(env, "categories?fudo_id=not.is.null&select=id,fudo_id");
  const catId = new Map(cats.map((c) => [c.fudo_id as number, c.id]));
  const currentCategory = new Map(existing.map((p) => [p.id, p.category_id]));
  const resolve = (fudoCategoryId: number | null, fallback: string | null): string | null =>
    fudoCategoryId === null ? fallback : (catId.get(fudoCategoryId) ?? fallback);

  if (plan.productInserts.length) {
    const rows = plan.productInserts.map(({ category_fudo_id, ...p }) => ({ ...p, category_id: resolve(category_fudo_id, null), ...fudoCols }));
    await rest(env, `products${UPSERT_BY_FUDO_ID}`, { method: "POST", headers: MERGE, body: JSON.stringify(rows) });
  }
  if (plan.productUpdates.length) {
    // Filas con las mismas claves: PostgREST rellena con DEFAULT las que falten y pisaría datos.
    const rows = plan.productUpdates.map(({ category_fudo_id, ...p }) => ({
      ...p,
      category_id: resolve(category_fudo_id, currentCategory.get(p.id) ?? null),
      ...fudoCols,
    }));
    await rest(env, "products?on_conflict=id", { method: "POST", headers: MERGE, body: JSON.stringify(rows) });
  }
  for (const ids of chunk(plan.deactivate, ID_BATCH)) {
    await rest(env, `products?id=in.(${idList(ids)})`, { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ is_active: false, fudo_synced_at: stamp }) });
  }

  // Auto-mapeo: cada producto vinculado queda en fudo_product_map, que es lo que lee el armado del pedido.
  const linked = await rest<Array<{ id: string; fudo_id: number; name: string }>>(env, "products?fudo_id=not.is.null&select=id,fudo_id,name");
  if (linked.length) {
    const mapRows = linked.map((p) => ({ product_id: p.id, fudo_product_id: p.fudo_id, fudo_name: p.name.slice(0, 120), updated_at: stamp }));
    await rest(env, "fudo_product_map?on_conflict=product_id", {
      method: "POST",
      headers: { prefer: "return=minimal,resolution=merge-duplicates" },
      body: JSON.stringify(mapRows),
    });
  }
}

async function logRun(env: DbEnv, summary: CatalogSyncSummary | null, error: string | null): Promise<void> {
  try {
    await rest(env, "fudo_sync_runs", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({
        ok: error === null,
        categories_created: summary?.categoriesCreated ?? 0,
        categories_updated: summary?.categoriesUpdated ?? 0,
        products_created: summary?.productsCreated ?? 0,
        products_updated: summary?.productsUpdated ?? 0,
        products_deactivated: summary?.productsDeactivated ?? 0,
        error: error?.slice(0, 500) ?? null,
      }),
    });
  } catch {
    // La bitácora no debe cambiar el resultado de la sincronización.
  }
}

/**
 * Trae el catálogo de Fudo y lo refleja en la app. Idempotente: una segunda corrida sin cambios no escribe nada.
 * Con `dryRun` calcula el plan y devuelve las cuentas sin tocar la base ni la bitácora.
 */
export async function syncCatalog(env: FudoEnv & DbEnv, dryRun = false): Promise<CatalogSyncSummary> {
  try {
    const [rawProducts, rawCategories, state] = await Promise.all([listFudoProducts(env), listFudoCategories(env), loadState(env)]);
    const plan = planCatalogSync({
      fudoProducts: parseFudoProducts(rawProducts),
      fudoCategories: parseFudoCategories(rawCategories),
      ...state,
    });
    if (!dryRun) await applyPlan(env, plan, state.products);
    const summary: CatalogSyncSummary = {
      categoriesCreated: plan.categoryInserts.length,
      categoriesUpdated: plan.categoryUpdates.length,
      productsCreated: plan.productInserts.length,
      productsUpdated: plan.productUpdates.length,
      productsDeactivated: plan.deactivate.length,
      deactivationBlocked: plan.deactivationBlocked,
      dryRun,
    };
    if (plan.deactivationBlocked > 0) {
      console.warn(`[fudo.catalog] guardarraíl: Fudo devolvió un listado corto; no se desactivaron ${plan.deactivationBlocked} productos.`);
    }
    const changed = [summary.categoriesCreated, summary.categoriesUpdated, summary.productsCreated, summary.productsUpdated, summary.productsDeactivated].some((n) => n > 0);
    if (changed && !dryRun) await logRun(env, summary, null);
    return summary;
  } catch (e) {
    if (!dryRun) await logRun(env, null, e instanceof Error ? e.message : String(e));
    throw e;
  }
}
