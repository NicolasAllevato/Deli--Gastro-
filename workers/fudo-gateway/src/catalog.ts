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
    });
  }
  return out;
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
  const fudoProducts = input.fudoProducts.filter(
    (p) => p.sellAlone !== false && (p.categoryId === null || !excludedCategoryIds.has(p.categoryId)),
  );
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
        plan.productInserts.push({ name: fp.name, price: fp.price, is_active: true, fudo_id: fp.id, category_fudo_id: fp.categoryId });
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
      category_fudo_id: fp.categoryId,
    };
    // Una categoría que todavía no existe (se crea en esta corrida) cuenta como cambio pendiente.
    const knownCategory = fp.categoryId === null ? undefined : catByFudo.get(fp.categoryId);
    const categoryOk = fp.categoryId === null || (knownCategory !== undefined && match.category_id === knownCategory.id);
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
