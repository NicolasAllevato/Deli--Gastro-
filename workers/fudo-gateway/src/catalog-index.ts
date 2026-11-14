import { parseFudoCategories, parseFudoProducts } from "./catalog";
import { listFudoCategories, listFudoProducts, type FudoEnv } from "./fudo";
import { buildCatalogIndex, catalogFromCache, catalogToCache, EMPTY_CATALOG, type FudoCatalogIndex } from "./sale-lines.ts";

/** Clave y vida del catálogo de Fudo cacheado en KV (nombres de productos y categoría de opciones). */
export const CATALOG_KV_KEY = "fudo:catalog-index:v2";
const CATALOG_TTL_SECONDS = 6 * 3600;

/**
 * Catálogo de Fudo para nombrar líneas de ventas: primero KV; si no está, `GET /products` y
 * `GET /product-categories` y se cachea. Si Fudo falla, devuelve un catálogo vacío: la venta igual entra
 * (con el comentario o "Producto Fudo #id" como nombre), no se frena el sync por esto.
 */
export async function loadCatalogIndex(env: FudoEnv, fresh = false): Promise<FudoCatalogIndex> {
  if (!fresh) {
    try {
      const cached = catalogFromCache(await env.FUDO_KV.get(CATALOG_KV_KEY, "json"));
      if (cached && cached.products.size > 0) return cached;
    } catch {
      // KV caído o valor corrupto: se recalcula.
    }
  }
  try {
    const [products, categories] = await Promise.all([listFudoProducts(env), listFudoCategories(env)]);
    const index = buildCatalogIndex(parseFudoProducts(products), parseFudoCategories(categories));
    if (index.products.size > 0) {
      await env.FUDO_KV.put(CATALOG_KV_KEY, JSON.stringify(catalogToCache(index)), { expirationTtl: CATALOG_TTL_SECONDS });
    }
    return index;
  } catch (e) {
    console.warn("fudo catalog index:", e instanceof Error ? e.message : String(e));
    return EMPTY_CATALOG;
  }
}
