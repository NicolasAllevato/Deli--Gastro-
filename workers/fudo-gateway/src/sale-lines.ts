/**
 * Líneas legibles de una venta de Fudo. Sin I/O.
 *
 * Fudo arma los pedidos de PedidosYa/Rappi con estos tipos de ítem:
 *  - productos normales (pueden no estar en nuestro mapeo `fudo_product_map`): se usa el nombre del catálogo de Fudo;
 *  - "Producto Genérico": el nombre real viene en el `comment` del ítem ("Combo para compartir - ");
 *  - ítems a precio 0 de la categoría "Opciones" (gustos de empanada) y "Opcional Genérico" a precio 0 (nombre en el
 *    comentario, p. ej. "Pizza muzzarella (8 porciones)"): son productos que vinieron DENTRO del ítem anterior.
 *
 * Qué es un combo (`is_combo`):
 *  - un "Producto Genérico" que terminó con opciones colgadas, o
 *  - un producto cuya categoría en Fudo tiene "combo" o "promo" en el nombre (sin tildes ni mayúsculas).
 * Los informes además tratan como combo a los productos de la app con categoría combo/promo (ver product-sales.ts).
 *
 * Los gustos se normalizan con el producto real del catálogo cuando hay un único candidato claro
 * ("Carne" → "Empanada de carne"); si no, queda el nombre de Fudo. Siempre se conserva el id de Fudo y el comentario.
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

/** Catálogo de Fudo resumido: id de producto → nombre y categoría, más las categorías de opciones y de combos. */
export interface FudoCatalogIndex {
  products: ReadonlyMap<number, CatalogEntry>;
  optionCategoryIds: ReadonlySet<number>;
  comboCategoryIds: ReadonlySet<number>;
}

export interface LineOption {
  qty: number;
  name: string;
  /** Producto de la app, si el gusto se pudo resolver a un producto mapeado. */
  product_id?: string | null;
  fudo_product_id?: number | null;
}

export interface OrderLineInsert {
  product_id: string | null;
  name: string;
  qty: number;
  unit_price: number;
  fudo_product_id: number | null;
  fudo_comment: string | null;
  fudo_options: LineOption[] | null;
  is_combo: boolean;
}

export const EMPTY_CATALOG: FudoCatalogIndex = { products: new Map(), optionCategoryIds: new Set(), comboCategoryIds: new Set() };

const NAME_MAX = 120;
const COMMENT_MAX = 300;

/** Minúsculas, sin tildes ni espacios repetidos: para comparar nombres de Fudo. */
export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

const PRODUCT_GENERIC = "producto generico";
const OPTIONAL_GENERIC = "opcional generico";
const OPTION_CATEGORY_NAMES: readonly string[] = ["opciones"];

/** Categoría de combos: el nombre contiene "combo" o "promo" (Combos, Promociones, Promos del día…). */
export function isComboCategoryName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = normalizeName(name);
  return n.includes("combo") || n.includes("promo");
}

export function isGenericName(name: string | null | undefined): boolean {
  if (!name) return false;
  const n = normalizeName(name);
  return n === PRODUCT_GENERIC || n === OPTIONAL_GENERIC;
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
    comboCategoryIds: new Set(categories.filter((c) => isComboCategoryName(c.name)).map((c) => c.id)),
  };
}

const STOPWORDS = new Set(["de", "del", "y", "con", "la", "el", "los", "las", "a", "al", "en"]);
const tokens = (name: string): Set<string> => new Set(normalizeName(name).split(/[^a-z0-9]+/).filter((t) => t && !STOPWORDS.has(t)));

/**
 * Producto real de un gusto: un producto del catálogo (fuera de Opciones, genéricos y combos) que tiene todas las
 * palabras del gusto más UNA sola palabra extra ("Carne" → "Empanada de carne"; "Cebolla y queso" → "Empanada de
 * queso y cebolla"). Si hay cero o más de un candidato, no se adivina: `null`.
 */
export function resolveOptionProduct(optionName: string, catalog: FudoCatalogIndex): { id: number; name: string } | null {
  const want = tokens(optionName);
  if (want.size === 0) return null;
  const found: Array<{ id: number; name: string }> = [];
  for (const [id, e] of catalog.products) {
    if (isGenericName(e.name)) continue;
    if (e.categoryId != null && (catalog.optionCategoryIds.has(e.categoryId) || catalog.comboCategoryIds.has(e.categoryId))) continue;
    const have = tokens(e.name);
    if (have.size !== want.size + 1) continue;
    if ([...want].every((t) => have.has(t))) found.push({ id, name: e.name });
  }
  return found.length === 1 ? found[0]! : null;
}

function entryOf(item: SaleLineItem, catalog: FudoCatalogIndex): CatalogEntry | undefined {
  return item.productId === null ? undefined : catalog.products.get(item.productId);
}

/** Ítem que va DENTRO del anterior: gusto de "Opciones" a precio 0 u "Opcional Genérico" a precio 0. */
function isInnerItem(item: SaleLineItem, catalog: FudoCatalogIndex): boolean {
  if (item.price !== 0) return false;
  const entry = entryOf(item, catalog);
  if (!entry) return false;
  if (normalizeName(entry.name) === OPTIONAL_GENERIC) return cleanComment(item.comment) !== null;
  return entry.categoryId != null && catalog.optionCategoryIds.has(entry.categoryId) && !isGenericName(entry.name);
}

function lineName(item: SaleLineItem, mapped: { name: string } | undefined, entry: CatalogEntry | undefined): string {
  if (isGenericName(entry?.name)) return cleanComment(item.comment) ?? entry!.name;
  if (mapped) return mapped.name;
  if (entry) return entry.name;
  return cleanComment(item.comment) ?? (item.productId === null ? "Producto de Fudo" : `Producto Fudo #${item.productId}`);
}

function innerOption(item: SaleLineItem, mapped: ReadonlyMap<number, { id: string; name: string }>, catalog: FudoCatalogIndex): LineOption {
  const entry = entryOf(item, catalog)!;
  if (normalizeName(entry.name) === OPTIONAL_GENERIC) {
    return { qty: item.quantity, name: cleanComment(item.comment)!, product_id: null, fudo_product_id: item.productId };
  }
  const real = resolveOptionProduct(entry.name, catalog);
  const app = real ? mapped.get(real.id) : undefined;
  return {
    qty: item.quantity,
    name: app?.name ?? real?.name ?? entry.name,
    product_id: app?.id ?? null,
    fudo_product_id: real?.id ?? item.productId,
  };
}

/**
 * Ítems de la venta (en el orden de Fudo) → líneas del pedido. Los ítems internos (gustos, opcional genérico) se
 * cuelgan de la línea anterior; si no hay anterior, quedan como línea propia para no perderlos.
 */
export function buildSaleLines(
  items: readonly SaleLineItem[],
  mapped: ReadonlyMap<number, { id: string; name: string }>,
  catalog: FudoCatalogIndex = EMPTY_CATALOG,
): OrderLineInsert[] {
  const lines: OrderLineInsert[] = [];
  const genericLine = new Set<OrderLineInsert>();
  for (const item of items) {
    if (item.canceled) continue;
    const entry = entryOf(item, catalog);
    const last = lines[lines.length - 1];
    if (last && isInnerItem(item, catalog)) {
      const option = innerOption(item, mapped, catalog);
      lines[lines.length - 1] = { ...last, fudo_options: [...(last.fudo_options ?? []), option], is_combo: last.is_combo || genericLine.has(last) };
      if (genericLine.has(last)) genericLine.add(lines[lines.length - 1]!);
      continue;
    }
    const generic = isGenericName(entry?.name);
    const product = item.productId === null || generic ? undefined : mapped.get(item.productId);
    const line: OrderLineInsert = {
      product_id: product?.id ?? null,
      name: lineName(item, product, entry),
      qty: item.quantity,
      unit_price: item.price,
      fudo_product_id: item.productId,
      fudo_comment: item.comment ? item.comment.slice(0, COMMENT_MAX) : null,
      fudo_options: null,
      is_combo: entry?.categoryId != null && catalog.comboCategoryIds.has(entry.categoryId),
    };
    if (generic && normalizeName(entry!.name) === PRODUCT_GENERIC) genericLine.add(line);
    lines.push(line);
  }
  return lines;
}

/** "1x Combo para compartir (2x Verduras, 1x Pizza muzzarella (8 porciones)) · 2x Coca". */
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
  c: number[];
}

export function catalogToCache(c: FudoCatalogIndex): CatalogCache {
  return { p: [...c.products].map(([id, e]) => [id, e.name, e.categoryId]), o: [...c.optionCategoryIds], c: [...c.comboCategoryIds] };
}

export function catalogFromCache(raw: unknown): FudoCatalogIndex | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { p, o, c } = raw as Partial<CatalogCache>;
  if (!Array.isArray(p) || !Array.isArray(o) || !Array.isArray(c)) return null;
  const ids = (list: unknown[]) => new Set(list.filter((n): n is number => typeof n === "number"));
  return {
    products: new Map(p.filter((r) => Array.isArray(r) && typeof r[0] === "number" && typeof r[1] === "string").map((r) => [r[0], { name: r[1], categoryId: r[2] ?? null }])),
    optionCategoryIds: ids(o),
    comboCategoryIds: ids(c),
  };
}
