import { parseFudoCategories, parseFudoProducts, planCatalogSync, type CatalogPlan, type ExistingCategory, type ExistingProduct } from "@workers/fudo-gateway/src/catalog";
import { demoFudoCategoriesPayload, demoFudoProductsPayload } from "@/lib/demo/fudo-fixture";
import type { CatalogSyncSummary } from "@/lib/fudo/gateway";
import type { createAdminClient } from "@/utils/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Sync del catálogo de Fudo para el MODO DEMO. Usa el mismo plan que el Worker real (`planCatalogSync`),
 * así que decide exactamente igual, pero lee el Fudo simulado (`fudo-fixture.ts`) y escribe en la base en
 * memoria. En producción lo hace `workers/fudo-gateway/src/catalog-sync.ts` por la API REST de Supabase.
 */

function fail(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

async function loadState(db: Db): Promise<{ categories: ExistingCategory[]; products: ExistingProduct[] }> {
  const [categories, products] = await Promise.all([
    db.from("categories").select("id,name,fudo_id"),
    db.from("products").select("id,name,fudo_id,price,is_active,category_id"),
  ]);
  fail(categories.error);
  fail(products.error);
  return {
    categories: (categories.data ?? []) as ExistingCategory[],
    products: ((products.data ?? []) as Array<Omit<ExistingProduct, "price"> & { price: number | string }>).map((p) => ({ ...p, price: Number(p.price) })),
  };
}

async function applyPlan(db: Db, plan: CatalogPlan, existing: ExistingProduct[]): Promise<void> {
  const stamp = new Date().toISOString();
  const fudoCols = { source: "fudo" as const, fudo_synced_at: stamp };

  if (plan.categoryInserts.length) {
    fail((await db.from("categories").insert(plan.categoryInserts.map((c) => ({ ...c, ...fudoCols })))).error);
  }
  for (const c of plan.categoryUpdates) {
    fail((await db.from("categories").update({ name: c.name, fudo_id: c.fudo_id, ...fudoCols }).eq("id", c.id)).error);
  }

  const cats = await db.from("categories").select("id,fudo_id").not("fudo_id", "is", null);
  fail(cats.error);
  const catId = new Map(((cats.data ?? []) as Array<{ id: string; fudo_id: number }>).map((c) => [c.fudo_id, c.id]));
  const currentCategory = new Map(existing.map((p) => [p.id, p.category_id]));
  const resolve = (fudoCategoryId: number | null, fallback: string | null): string | null =>
    fudoCategoryId === null ? fallback : (catId.get(fudoCategoryId) ?? fallback);

  if (plan.productInserts.length) {
    const rows = plan.productInserts.map(({ category_fudo_id, ...p }) => ({ ...p, category_id: resolve(category_fudo_id, null), ...fudoCols }));
    fail((await db.from("products").insert(rows)).error);
  }
  for (const { id, category_fudo_id, ...p } of plan.productUpdates) {
    const patch = { ...p, category_id: resolve(category_fudo_id, currentCategory.get(id) ?? null), ...fudoCols };
    fail((await db.from("products").update(patch).eq("id", id)).error);
  }
  if (plan.deactivate.length) {
    fail((await db.from("products").update({ is_active: false, fudo_synced_at: stamp }).in("id", plan.deactivate)).error);
  }

  // Auto-mapeo: cada producto vinculado queda en fudo_product_map, que es lo que lee el armado del pedido.
  const linked = await db.from("products").select("id,fudo_id,name").not("fudo_id", "is", null);
  fail(linked.error);
  const mapRows = ((linked.data ?? []) as Array<{ id: string; fudo_id: number; name: string }>).map((p) => ({
    product_id: p.id,
    fudo_product_id: p.fudo_id,
    fudo_name: p.name.slice(0, 120),
    updated_at: stamp,
  }));
  if (mapRows.length) fail((await db.from("fudo_product_map").upsert(mapRows, { onConflict: "product_id" })).error);
}

/** Con `dryRun` calcula el plan y devuelve las cuentas sin tocar la base. */
export async function runDemoCatalogSync(db: Db, dryRun: boolean): Promise<CatalogSyncSummary> {
  const state = await loadState(db);
  const plan = planCatalogSync({
    fudoProducts: parseFudoProducts(demoFudoProductsPayload()),
    fudoCategories: parseFudoCategories(demoFudoCategoriesPayload()),
    ...state,
  });
  if (!dryRun) await applyPlan(db, plan, state.products);
  return {
    categoriesCreated: plan.categoryInserts.length,
    categoriesUpdated: plan.categoryUpdates.length,
    productsCreated: plan.productInserts.length,
    productsUpdated: plan.productUpdates.length,
    productsDeactivated: plan.deactivate.length,
    deactivationBlocked: plan.deactivationBlocked,
    dryRun,
  };
}
