import type { createAdminClient } from "@/utils/supabase/admin";
import { buildPackContext, type PackContext } from "@/lib/agent/empanadas";
import {
  buildModifierCatalog,
  EMPTY_CATALOG,
  type ModifierCatalog,
  type ModifierGroupRow,
  type ModifierOptionRow,
  type ProductGroupRow,
} from "@/lib/order-options";

type Db = ReturnType<typeof createAdminClient>;

export interface DocenaConfig {
  docenaFudoId: number;
  docenaUnits: number;
  gustosMap: Record<string, number>;
}

function asNumber(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v.trim()) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** La config de la docena sale de `global_config` (JSON ya parseado o texto). `null` si falta algo. */
export function docenaConfigFrom(config: Record<string, unknown>): DocenaConfig | null {
  const docenaFudoId = asNumber(config.docena_fudo_id);
  const docenaUnits = asNumber(config.docena_unidades);
  let map: unknown = config.empanada_gustos_map;
  if (typeof map === "string") {
    try {
      map = JSON.parse(map);
    } catch {
      map = null;
    }
  }
  if (docenaFudoId === null || docenaUnits === null || typeof map !== "object" || map === null || Array.isArray(map)) return null;
  const gustosMap: Record<string, number> = {};
  for (const [k, v] of Object.entries(map as Record<string, unknown>)) {
    const n = asNumber(v);
    if (n !== null) gustosMap[k] = n;
  }
  return { docenaFudoId, docenaUnits, gustosMap };
}

/** Catálogo de modificadores de los productos dados (por id Fudo). Un error de lectura cuenta como "sin modificadores". */
export async function loadModifierCatalog(db: Db, productFudoIds: readonly number[]): Promise<ModifierCatalog> {
  if (productFudoIds.length === 0) return EMPTY_CATALOG;
  const { data: pg, error } = await db.from("fudo_product_groups").select("product_fudo_id, group_fudo_id").in("product_fudo_id", [...productFudoIds]);
  const productGroups = (pg ?? []) as ProductGroupRow[];
  if (error || productGroups.length === 0) return EMPTY_CATALOG;
  const groupIds = [...new Set(productGroups.map((r) => r.group_fudo_id))];
  const [{ data: groups }, { data: options }] = await Promise.all([
    db.from("fudo_modifier_groups").select("fudo_id, name, min_qty, max_qty").in("fudo_id", groupIds),
    db.from("fudo_modifier_options").select("fudo_id, group_fudo_id, product_fudo_id, name, price_cents, position, is_active").in("group_fudo_id", groupIds),
  ]);
  return buildModifierCatalog({
    groups: (groups ?? []) as ModifierGroupRow[],
    options: (options ?? []) as ModifierOptionRow[],
    productGroups,
  });
}

/**
 * Contexto para empaquetar empanadas sueltas en docenas. `null` si no hay config, si el pedido no trae ninguna
 * suelta o si falta el producto docena en `products` (entonces no se empaqueta).
 */
export async function loadPackContext(
  db: Db,
  config: Record<string, unknown>,
  orderProducts: ReadonlyArray<{ id: string; fudo_id?: number | null }>,
): Promise<PackContext | null> {
  const cfg = docenaConfigFrom(config);
  if (!cfg) return null;
  const looseIds = new Set(Object.keys(cfg.gustosMap));
  if (!orderProducts.some((p) => p.fudo_id != null && looseIds.has(String(p.fudo_id)))) return null;

  const { data: products } = await db.from("products").select("id, fudo_id").in("fudo_id", [cfg.docenaFudoId, ...looseIds.values()].map(Number));
  const rows = ((products ?? []) as Array<{ id: string; fudo_id: number | null }>).map((p) => ({ id: p.id, fudo_id: p.fudo_id === null ? null : Number(p.fudo_id) }));
  const catalog = await loadModifierCatalog(db, [cfg.docenaFudoId]);
  const groupIds = catalog.groupsByProduct.get(cfg.docenaFudoId) ?? [];
  const docenaOptions = [...catalog.options.values()].filter((o) => groupIds.includes(o.group_fudo_id));
  return buildPackContext({ ...cfg, products: rows, docenaOptions });
}
