/**
 * Sincronización del catálogo Fudo -> Deli-Gastro. Sin I/O: parseo tolerante de la respuesta de Fudo y
 * plan de cambios (qué crear, qué actualizar, qué desactivar). Regla: Fudo manda en nombre, precio,
 * disponibilidad y categoría; la app conserva foto, descripción y puntos. Ver docs/FUDO_INTEGRACION.md.
 */

export interface FudoProduct {
  id: number;
  name: string;
  /** null cuando Fudo no lo informa (o viene inválido): en ese caso no se pisa el precio de la app. */
  price: number | null;
  active: boolean;
  categoryId: number | null;
  /** Fudo: `true` se vende solo; `false` es una opción o modificador de otro plato; null = sin dato. */
  sellAlone?: boolean | null;
  /** Ids de los grupos de modificadores (sabores, bebidas de promo) asociados al producto. [] si no tiene. */
  modifierGroupIds?: number[];
}

export interface FudoModifierGroup {
  id: number;
  name: string;
  minQty: number | null;
  maxQty: number | null;
  required: boolean;
  kind: string | null;
}

/** Un ProductModifier: el "producto" es el sabor/bebida (suele valer $0); el nombre sale de ese producto. */
export interface FudoModifier {
  id: number;
  groupId: number;
  productId: number;
  name: string | null;
  price: number | null;
}

export interface FudoCategory {
  id: number;
  name: string;
}

export const NAME_MAX = 120;

/** Categorías de Fudo que son opciones y modificadores, no platos de la carta. Se comparan sin tildes ni mayúsculas. */
export const EXCLUDED_CATEGORIES: readonly string[] = ["opciones", "modificadores genericos", "productos genericos"];

type Entry = Record<string, unknown>;

const isObject = (v: unknown): v is Entry => typeof v === "object" && v !== null && !Array.isArray(v);

function listFrom(raw: unknown, ...keys: string[]): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (!isObject(raw)) return [];
  for (const key of [...keys, "data"]) {
    if (Array.isArray(raw[key])) return raw[key] as unknown[];
  }
  return [];
}

function positiveInt(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isInteger(n) && n > 0 ? n : null;
}

function cleanName(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, NAME_MAX) : null;
}

function validPrice(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

/** Los campos pueden venir planos o dentro de `attributes` (JSON:API). */
const field = (e: Entry, key: string): unknown => (isObject(e.attributes) && key in e.attributes ? e.attributes[key] : e[key]);

function relationId(e: Entry, name: string): unknown {
  const rel = isObject(e.relationships) ? e.relationships[name] : undefined;
  return isObject(rel) && isObject(rel.data) ? rel.data.id : undefined;
}

function relationIds(e: Entry, name: string): number[] {
  const rel = isObject(e.relationships) ? e.relationships[name] : undefined;
  if (!isObject(rel) || !Array.isArray(rel.data)) return [];
  const ids: number[] = [];
  for (const item of rel.data) {
    const id = isObject(item) ? positiveInt(item.id) : null;
    if (id !== null && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function categoryIdOf(e: Entry): number | null {
  const nested = isObject(e.category) ? e.category.id : isObject(e.productCategory) ? e.productCategory.id : undefined;
  return positiveInt(field(e, "productCategoryId") ?? field(e, "categoryId") ?? nested ?? relationId(e, "productCategory") ?? relationId(e, "category"));
}

export function parseFudoProducts(raw: unknown): FudoProduct[] {
  const out: FudoProduct[] = [];
  for (const entry of listFrom(raw, "products")) {
    if (!isObject(entry)) continue;
    const id = positiveInt(entry.id);
    const name = cleanName(field(entry, "name"));
    if (id === null || name === null) continue;
    const sellAlone = field(entry, "sellAlone");
    out.push({
      id,
      name,
      price: validPrice(field(entry, "price")),
      active: field(entry, "active") !== false,
      categoryId: categoryIdOf(entry),
      sellAlone: typeof sellAlone === "boolean" ? sellAlone : null,
      modifierGroupIds: relationIds(entry, "productModifiersGroups"),
    });
  }
  return out;
}

function optionalQty(v: unknown): number | null {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseFudoModifierGroups(raw: unknown): FudoModifierGroup[] {
  const out: FudoModifierGroup[] = [];
  for (const entry of listFrom(raw, "productModifiersGroups")) {
    if (!isObject(entry)) continue;
    const id = positiveInt(entry.id);
    const name = cleanName(field(entry, "name"));
    if (id === null || name === null) continue;
    const kind = field(entry, "kind");
    out.push({
      id,
      name,
      minQty: optionalQty(field(entry, "minQuantity")),
      maxQty: optionalQty(field(entry, "maxQuantity")),
      required: field(entry, "required") === true,
      kind: typeof kind === "string" && kind.trim() ? kind.trim() : null,
    });
  }
  return out;
}

export function parseFudoModifiers(raw: unknown): FudoModifier[] {
  const out: FudoModifier[] = [];
  for (const entry of listFrom(raw, "productModifiers")) {
    if (!isObject(entry)) continue;
    const id = positiveInt(entry.id);
    const groupId = positiveInt(relationId(entry, "productModifiersGroup"));
    const productId = positiveInt(relationId(entry, "product"));
    if (id === null || groupId === null || productId === null) continue;
    out.push({ id, groupId, productId, name: cleanName(field(entry, "name")), price: validPrice(field(entry, "price")) });
  }
  return out;
}

export interface ModifierGroupRow { fudo_id: number; name: string; min_qty: number | null; max_qty: number | null; required: number; kind: string | null }
export interface ModifierOptionRow { fudo_id: number; group_fudo_id: number; product_fudo_id: number; name: string; price_cents: number; position: number; is_active: number }
export interface ProductGroupRow { product_fudo_id: number; group_fudo_id: number }
export interface ModifierSyncPlan { groups: ModifierGroupRow[]; options: ModifierOptionRow[]; productGroups: ProductGroupRow[] }

/**
 * Filas de modificadores listas para D1. El nombre de cada opción sale del producto sabor (Fudo guarda el sabor
 * como un producto); sin producto conocido se usa el nombre del modificador, y sin ninguno de los dos la opción se
 * descarta. El PRECIO sale del ProductModifier (`attributes.price`), nunca del producto: el producto Pepsi cuesta
 * $3.500 suelto pero dentro de una promo su modificador vale $0. Solo se vinculan productos con grupos que existen.
 */
export function planModifierSync(input: { groups: FudoModifierGroup[]; modifiers: FudoModifier[]; products: FudoProduct[] }): ModifierSyncPlan {
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const groupIds = new Set(input.groups.map((g) => g.id));
  const groups = input.groups.map((g) => ({
    fudo_id: g.id, name: g.name, min_qty: g.minQty, max_qty: g.maxQty, required: g.required ? 1 : 0, kind: g.kind,
  }));
  const positions = new Map<number, number>();
  const options: ModifierOptionRow[] = [];
  for (const m of input.modifiers) {
    if (!groupIds.has(m.groupId)) continue;
    const product = productById.get(m.productId);
    const name = product?.name ?? m.name;
    if (!name) continue;
    const position = positions.get(m.groupId) ?? 0;
    positions.set(m.groupId, position + 1);
    options.push({
      fudo_id: m.id,
      group_fudo_id: m.groupId,
      product_fudo_id: m.productId,
      name,
      price_cents: Math.round((m.price ?? 0) * 100),
      position,
      is_active: product ? (product.active ? 1 : 0) : 1,
    });
  }
  const productGroups = input.products.flatMap((p) =>
    (p.modifierGroupIds ?? []).filter((g) => groupIds.has(g)).map((g) => ({ product_fudo_id: p.id, group_fudo_id: g })),
  );
  return { groups, options, productGroups };
}

export function parseFudoCategories(raw: unknown): FudoCategory[] {
  const out: FudoCategory[] = [];
  for (const entry of listFrom(raw, "productCategories", "categories")) {
    if (!isObject(entry)) continue;
    const id = positiveInt(entry.id);
    const name = cleanName(field(entry, "name"));
    if (id !== null && name !== null) out.push({ id, name });
  }
  return out;
}

export interface ExistingCategory { id: string; name: string; fudo_id: number | null }
export interface ExistingProduct {
  id: string;
  name: string;
  fudo_id: number | null;
  price: number;
  is_active: boolean;
  category_id: string | null;
}

export interface CategoryInsert { name: string; fudo_id: number }
export interface CategoryUpdate { id: string; name: string; fudo_id: number }
/** `category_fudo_id` se resuelve a `category_id` al aplicar (las categorías nuevas todavía no tienen uuid). */
export interface ProductInsert { name: string; price: number; is_active: boolean; fudo_id: number; category_fudo_id: number | null }
export interface ProductUpdate extends ProductInsert { id: string }

export interface CatalogPlan {
  categoryInserts: CategoryInsert[];
  categoryUpdates: CategoryUpdate[];
  productInserts: ProductInsert[];
  productUpdates: ProductUpdate[];
  /** Productos vinculados a Fudo que ya no figuran en su catálogo. */
  deactivate: string[];
  /** Cuántas desactivaciones se frenaron por el guardarraíl (listado sospechosamente corto). 0 = ninguna. */
  deactivationBlocked: number;
}

/** Con al menos esta cantidad de productos vinculados activos se aplica el guardarraíl de desactivación. */
export const GUARD_MIN_LINKED = 4;
/** Si el listado de Fudo cubre menos que esta fracción de los vinculados activos, se asume respuesta incompleta. */
export const GUARD_MIN_COVERAGE = 0.5;

export interface PlanInput {
  fudoCategories: FudoCategory[];
  fudoProducts: FudoProduct[];
  categories: ExistingCategory[];
  products: ExistingProduct[];
}

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toLowerCase();

/** Encuentra la fila existente: primero por id de Fudo; si no, por nombre entre las todavía sin vincular. */
function findMatch<T extends { id: string; name: string; fudo_id: number | null }>(
  rows: T[],
  fudoId: number,
  name: string,
  taken: Set<string>,
): T | undefined {
  const linked = rows.find((r) => r.fudo_id === fudoId);
  if (linked) return linked;
  return rows.find((r) => r.fudo_id === null && !taken.has(r.id) && norm(r.name) === norm(name));
}

export function planCatalogSync(input: PlanInput): CatalogPlan {
  const excludedCategoryIds = new Set(input.fudoCategories.filter((c) => EXCLUDED_CATEGORIES.includes(norm(c.name))).map((c) => c.id));
  const fudoCategories = input.fudoCategories.filter((c) => !excludedCategoryIds.has(c.id));
  // Solo lo que se vende solo y no es una opción/modificador (Fudo marca sellAlone=false en esos).
  // Excepción: un producto con grupos de modificadores (p. ej. la docena de empanadas) activo y con precio
  // es vendible aunque esté en una categoría excluida o no marque sellAlone. Los sabores no tienen grupos.
  const hasGroups = (p: FudoProduct): boolean => (p.modifierGroupIds ?? []).length > 0;
  const isExcluded = (p: FudoProduct): boolean => p.categoryId !== null && excludedCategoryIds.has(p.categoryId);
  const fudoProducts = input.fudoProducts.filter(
    (p) => (p.sellAlone !== false && !isExcluded(p)) || (hasGroups(p) && p.active && p.price !== null && p.price > 0),
  );
  // Un producto vendible de categoría excluida no se asigna a categoría (esa categoría no se importa).
  const categoryFudoId = (p: FudoProduct): number | null => (isExcluded(p) ? null : p.categoryId);
  const plan: CatalogPlan = { categoryInserts: [], categoryUpdates: [], productInserts: [], productUpdates: [], deactivate: [], deactivationBlocked: 0 };
  const catByFudo = new Map(input.categories.filter((c) => c.fudo_id !== null).map((c) => [c.fudo_id as number, c]));

  // Una categoría nueva solo se crea si va a tener algún producto: sin esto la carta mostraría pestañas vacías.
  const linkedFudoIds = new Set(input.products.filter((p) => p.fudo_id !== null).map((p) => p.fudo_id as number));
  const usedCategoryIds = new Set(
    fudoProducts
      .filter((p) => p.categoryId !== null && ((p.active && p.price !== null && p.price > 0) || linkedFudoIds.has(p.id)))
      .map((p) => p.categoryId as number),
  );

  const takenCats = new Set<string>();
  for (const fc of fudoCategories) {
    const match = findMatch(input.categories, fc.id, fc.name, takenCats);
    if (!match) {
      if (!usedCategoryIds.has(fc.id)) continue;
      plan.categoryInserts.push({ name: fc.name, fudo_id: fc.id });
      continue;
    }
    takenCats.add(match.id);
    catByFudo.set(fc.id, { ...match, fudo_id: fc.id });
    if (match.name !== fc.name || match.fudo_id !== fc.id) plan.categoryUpdates.push({ id: match.id, name: fc.name, fudo_id: fc.id });
  }

  const takenProducts = new Set<string>();
  const seenFudoIds = new Set<number>();
  for (const fp of fudoProducts) {
    seenFudoIds.add(fp.id);
    const match = findMatch(input.products, fp.id, fp.name, takenProducts);
    if (!match) {
      // Fudo arrastra muchos productos viejos o auxiliares: solo se crea lo vendible hoy (activo y con precio).
      if (fp.active && fp.price !== null && fp.price > 0) {
        plan.productInserts.push({ name: fp.name, price: fp.price, is_active: true, fudo_id: fp.id, category_fudo_id: categoryFudoId(fp) });
      }
      continue;
    }
    takenProducts.add(match.id);
    const next: ProductUpdate = {
      id: match.id,
      name: fp.name,
      price: fp.price ?? match.price,
      is_active: fp.active,
      fudo_id: fp.id,
      category_fudo_id: categoryFudoId(fp),
    };
    // Una categoría que todavía no existe (se crea en esta corrida) cuenta como cambio pendiente.
    const knownCategory = next.category_fudo_id === null ? undefined : catByFudo.get(next.category_fudo_id);
    const categoryOk = next.category_fudo_id === null || (knownCategory !== undefined && match.category_id === knownCategory.id);
    const unchanged =
      match.name === next.name && match.price === next.price && match.is_active === next.is_active &&
      match.fudo_id === next.fudo_id && categoryOk;
    if (!unchanged) plan.productUpdates.push(next);
  }

  // Con catálogo vacío no se desactiva nada: es más probable una respuesta rota que un local sin platos.
  if (fudoProducts.length > 0) {
    const linkedActive = input.products.filter((p) => p.fudo_id !== null && p.is_active);
    const missing: string[] = [];
    for (const p of input.products) {
      const stillThere = p.fudo_id !== null && seenFudoIds.has(p.fudo_id);
      if (p.fudo_id !== null && !stillThere && !takenProducts.has(p.id) && p.is_active) missing.push(p.id);
    }
    // Guardarraíl: si faltan más de la mitad de los vinculados activos, lo más probable es un listado
    // paginado o con otro formato, no que el local haya sacado media carta. No se desactiva nada.
    const coverage = linkedActive.length === 0 ? 1 : (linkedActive.length - missing.length) / linkedActive.length;
    if (linkedActive.length >= GUARD_MIN_LINKED && coverage < GUARD_MIN_COVERAGE) plan.deactivationBlocked = missing.length;
    else plan.deactivate.push(...missing);
  }
  return plan;
}
