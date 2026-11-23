import {
  parseFudoCategories,
  parseFudoModifierGroups,
  parseFudoModifiers,
  parseFudoProducts,
  planCatalogSync,
  planModifierSync,
  type ModifierSyncPlan,
  type CatalogPlan,
  type ExistingCategory,
  type ExistingProduct,
} from "./catalog.ts";
import { rest, type DbEnv } from "./db.ts";
import { listFudoCategories, listFudoModifierGroups, listFudoModifiers, listFudoProducts, type FudoEnv } from "./fudo.ts";

export interface CatalogSyncSummary {
  categoriesCreated: number;
  categoriesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  productsDeactivated: number;
  /** Desactivaciones frenadas por el guardarraíl (listado de Fudo sospechosamente corto). */
  deactivationBlocked: number;
  /** Grupos de modificadores (sabores) y opciones leídos de Fudo. */
  modifierGroups: number;
  modifierOptions: number;
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

/**
 * Aplica el plan: categorías primero (los productos las referencian), después productos, desactivados y mapeo.
 * Nunca escribe image_url, description, points_per_100 ni show_in_portal: son del admin. Los productos nuevos
 * quedan ocultos en el portal por el DEFAULT 0 de show_in_portal (migración D1 0009) hasta que el admin los active.
 */
export async function applyPlan(env: DbEnv, plan: CatalogPlan, existing: ExistingProduct[]): Promise<void> {
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

const NO_MODIFIERS: ModifierSyncPlan = { groups: [], options: [], productGroups: [] };

/**
 * Refleja los grupos de modificadores en D1: upsert por fudo_id de grupos y opciones, y reemplazo completo de
 * fudo_product_groups. Una respuesta sin grupos no borra nada (es más probable un listado roto que un local sin sabores).
 */
export async function applyModifiers(env: DbEnv, plan: ModifierSyncPlan): Promise<void> {
  if (plan.groups.length === 0) return;
  const byFudoId = { prefer: "return=minimal,resolution=merge-duplicates" };
  const upsert = (table: string, rows: unknown[]) =>
    rest(env, `${table}${UPSERT_BY_FUDO_ID}`, { method: "POST", headers: byFudoId, body: JSON.stringify(rows) });
  const stamp = new Date().toISOString();
  await upsert("fudo_modifier_groups", plan.groups.map((g) => ({ ...g, synced_at: stamp })));
  if (plan.options.length) await upsert("fudo_modifier_options", plan.options);

  const del = (path: string) => rest(env, path, { method: "DELETE", headers: { prefer: "return=minimal" } });
  const groupIds = plan.groups.map((g) => g.fudo_id).join(",");
  const optionIds = plan.options.map((o) => o.fudo_id).join(",");
  // Lo que Fudo ya no lista se borra (opciones primero, por la clave foránea hacia el grupo).
  await del(optionIds ? `fudo_modifier_options?fudo_id=not.in.(${optionIds})` : "fudo_modifier_options?fudo_id=gt.0");
  await del(`fudo_modifier_groups?fudo_id=not.in.(${groupIds})`);

  await del("fudo_product_groups?product_fudo_id=gt.0");
  for (const row of plan.productGroups) {
    await rest(env, "fudo_product_groups?on_conflict=product_fudo_id,group_fudo_id", { method: "POST", headers: byFudoId, body: JSON.stringify([row]) });
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

/** Los modificadores son un extra: si Fudo falla al listarlos, el catálogo se sincroniza igual. */
async function loadModifierPlan(env: FudoEnv, products: ReturnType<typeof parseFudoProducts>): Promise<ModifierSyncPlan> {
  try {
    const [rawGroups, rawModifiers] = await Promise.all([listFudoModifierGroups(env), listFudoModifiers(env)]);
    return planModifierSync({ groups: parseFudoModifierGroups(rawGroups), modifiers: parseFudoModifiers(rawModifiers), products });
  } catch (e) {
    console.warn("[fudo.catalog] modificadores no disponibles:", e instanceof Error ? e.message : String(e));
    return NO_MODIFIERS;
  }
}

async function applyModifiersSafely(env: DbEnv, plan: ModifierSyncPlan): Promise<void> {
  try {
    await applyModifiers(env, plan);
  } catch (e) {
    // Modo Supabase heredado: las tablas nuevas solo existen en D1 (migración 0023).
    console.warn("[fudo.catalog] no se pudieron guardar los modificadores:", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Trae el catálogo de Fudo y lo refleja en la app. Idempotente: una segunda corrida sin cambios no escribe nada.
 * Con `dryRun` calcula el plan y devuelve las cuentas sin tocar la base ni la bitácora.
 */
export async function syncCatalog(env: FudoEnv & DbEnv, dryRun = false): Promise<CatalogSyncSummary> {
  try {
    const [rawProducts, rawCategories, state] = await Promise.all([listFudoProducts(env), listFudoCategories(env), loadState(env)]);
    const fudoProducts = parseFudoProducts(rawProducts);
    const plan = planCatalogSync({ fudoProducts, fudoCategories: parseFudoCategories(rawCategories), ...state });
    const modifiers = await loadModifierPlan(env, fudoProducts);
    if (!dryRun) {
      await applyPlan(env, plan, state.products);
      await applyModifiersSafely(env, modifiers);
    }
    const summary: CatalogSyncSummary = {
      categoriesCreated: plan.categoryInserts.length,
      categoriesUpdated: plan.categoryUpdates.length,
      productsCreated: plan.productInserts.length,
      productsUpdated: plan.productUpdates.length,
      productsDeactivated: plan.deactivate.length,
      deactivationBlocked: plan.deactivationBlocked,
      modifierGroups: modifiers.groups.length,
      modifierOptions: modifiers.options.length,
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
