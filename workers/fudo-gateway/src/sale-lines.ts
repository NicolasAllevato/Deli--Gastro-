/**
 * Líneas legibles de una venta de Fudo. Sin I/O.
 *
 * Fudo arma los pedidos de PedidosYa/Rappi con tres tipos de ítem:
 *  - productos normales (pueden no estar en nuestro mapeo `fudo_product_map`): se usa el nombre del catálogo de Fudo;
 *  - "Producto Genérico" / "Opcional Genérico": el nombre real viene en el `comment` del ítem;
 *  - ítems de la categoría "Opciones" con precio 0 (gustos de empanada de un combo): son opciones del ítem anterior.
 * Siempre se conserva el id de producto de Fudo y el comentario original.
 */

export interface SaleLineItem {
  productId: number | null;
  quantity: number;
  price: number;
  canceled: boolean;
  comment: string | null;
}

export interface CatalogEntry {
  name: string;
  categoryId: number | null;
}

/** Catálogo de Fudo resumido: id de producto → nombre y categoría, más las categorías de opciones. */
export interface FudoCatalogIndex {
  products: ReadonlyMap<number, CatalogEntry>;
  optionCategoryIds: ReadonlySet<number>;
}

export interface LineOption {
  qty: number;
  name: string;
}

export interface OrderLineInsert {
  product_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
  fudo_product_id: number | null;
  fudo_comment: string | null;
  fudo_options: LineOption[] | null;
}

export const EMPTY_CATALOG: FudoCatalogIndex = { products: new Map(), optionCategoryIds: new Set() };

const NAME_MAX = 120;
const COMMENT_MAX = 300;

/** Minúsculas, sin tildes ni espacios repetidos: para comparar nombres de Fudo. */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const GENERIC_NAMES: readonly string[] = ["producto generico", "opcional generico"];
const OPTION_CATEGORY_NAMES: readonly string[] = ["opciones"];

export function isGenericName(name: string | null | undefined): boolean {
  return !!name && GENERIC_NAMES.includes(normalizeName(name));
}

/** "Combo para compartir - " → "Combo para compartir". Quita separadores sueltos al final o al inicio. */
export function cleanComment(comment: string | null | undefined): string | null {
  const out = (comment ?? "").replace(/^[\s\-–·,;:]+|[\s\-–·,;:]+$/g, "").replace(/\s+/g, " ");
  return out ? out.slice(0, NAME_MAX) : null;
}

/** Índice del catálogo a partir de productos y categorías ya parseados. */
export function buildCatalogIndex(
  products: ReadonlyArray<{ id: number; name: string; categoryId: number | null }>,
  categories: ReadonlyArray<{ id: number; name: string }>,
): FudoCatalogIndex {
  return {
    products: new Map(products.map((p) => [p.id, { name: p.name, categoryId: p.categoryId }])),
    optionCategoryIds: new Set(categories.filter((c) => OPTION_CATEGORY_NAMES.includes(normalizeName(c.name))).map((c) => c.id)),
  };
}

function isOption(item: SaleLineItem, catalog: FudoCatalogIndex): boolean {
  const entry = item.productId === null ? undefined : catalog.products.get(item.productId);
  return item.price === 0 && entry?.categoryId != null && catalog.optionCategoryIds.has(entry.categoryId) && !isGenericName(entry.name);
}

function lineName(item: SaleLineItem, mapped: { name: string } | undefined, catalog: FudoCatalogIndex): string {
  const entry = item.productId === null ? undefined : catalog.products.get(item.productId);
  if (isGenericName(entry?.name)) return cleanComment(item.comment) ?? entry!.name;
  if (mapped) return mapped.name;
  if (entry) return entry.name;
  return cleanComment(item.comment) ?? (item.productId === null ? "Producto de Fudo" : `Producto Fudo #${item.productId}`);
}

/**
 * Ítems de la venta (en el orden de Fudo) → líneas del pedido. Las opciones con precio 0 se cuelgan de la
 * línea anterior; si no hay anterior, quedan como línea propia para no perderlas.
 */
export function buildSaleLines(
  items: readonly SaleLineItem[],
  mapped: ReadonlyMap<number, { id: string; name: string }>,
  catalog: FudoCatalogIndex = EMPTY_CATALOG,
): OrderLineInsert[] {
  const lines: OrderLineInsert[] = [];
  for (const item of items) {
    if (item.canceled) continue;
    const entry = item.productId === null ? undefined : catalog.products.get(item.productId);
    const last = lines[lines.length - 1];
    if (last && isOption(item, catalog)) {
      const option = { qty: item.quantity, name: entry!.name };
      last.fudo_options = [...(last.fudo_options ?? []), option];
      continue;
    }
    const generic = isGenericName(entry?.name);
    const product = item.productId === null || generic ? undefined : mapped.get(item.productId);
    lines.push({
      product_id: product?.id ?? null,
      name: lineName(item, product, catalog),
      qty: item.quantity,
      unit_price: item.price,
      fudo_product_id: item.productId,
      fudo_comment: item.comment ? item.comment.slice(0, COMMENT_MAX) : null,
      fudo_options: null,
    });
  }
  return lines;
}

/** "1x Combo para compartir (2x Verduras, 1x Cebolla y queso) · 1x Pizza muzzarella (8 porciones)". */
export function saleItemsDesc(lines: readonly OrderLineInsert[]): string {
  return lines
    .map((l) => {
      const opts = l.fudo_options?.length ? ` (${l.fudo_options.map((o) => `${o.qty}x ${o.name}`).join(", ")})` : "";
      return `${l.qty}x ${l.name}${opts}`;
    })
    .join(" · ");
}

/** Forma compacta del catálogo para guardar en KV. */
export interface CatalogCache {
  p: Array<[number, string, number | null]>;
  o: number[];
}

export function catalogToCache(c: FudoCatalogIndex): CatalogCache {
  return { p: [...c.products].map(([id, e]) => [id, e.name, e.categoryId]), o: [...c.optionCategoryIds] };
}

export function catalogFromCache(raw: unknown): FudoCatalogIndex | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { p, o } = raw as Partial<CatalogCache>;
  if (!Array.isArray(p) || !Array.isArray(o)) return null;
  return {
    products: new Map(p.filter((r) => Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "string").map((r) => [r[0], { name: r[1], categoryId: r[2] ?? null }])),
    optionCategoryIds: new Set(o.filter((n): n is number => typeof n === "number")),
  };
}
