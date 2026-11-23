/**
 * Opciones (modificadores de Fudo) de una línea de pedido: sabores de la docena de empanadas, bebidas de las
 * promos. Lógica pura: sin base de datos. La lectura de las tablas está en `order-options-server.ts`.
 *
 * `option_id` = `fudo_modifier_options.fudo_id` (id del ProductModifier en Fudo). `qty` es POR UNIDAD de la línea
 * (una línea de 2 docenas con 12 gustos cada una lleva opciones que suman 12, no 24).
 */

export interface LineOptionInput {
  option_id: number;
  qty: number;
}

export interface ModifierGroupRow {
  fudo_id: number;
  name: string;
  min_qty: number | null;
  max_qty: number | null;
}

export interface ModifierOptionRow {
  fudo_id: number;
  group_fudo_id: number;
  product_fudo_id: number;
  name: string;
  price_cents: number;
  position?: number;
  /** D1 lo devuelve como boolean; el demo y Supabase pueden traer 0/1. */
  is_active?: boolean | number | null;
}

export interface ProductGroupRow {
  product_fudo_id: number;
  group_fudo_id: number;
}

export interface ModifierCatalog {
  groupsByProduct: ReadonlyMap<number, readonly number[]>;
  groups: ReadonlyMap<number, ModifierGroupRow>;
  options: ReadonlyMap<number, ModifierOptionRow>;
}

/** Opción ya resuelta contra el catálogo: lo que se guarda en `order_items.fudo_options` y se manda a Fudo. */
export interface ResolvedOption {
  option_id: number;
  group_fudo_id: number;
  product_fudo_id: number;
  name: string;
  /** Por unidad de la línea. */
  qty: number;
  /** Pesos por cada unidad de la opción (de `price_cents`, nunca del modelo). */
  price: number;
  /** Producto de la app equivalente al gusto (la empanada suelta), si se pudo resolver: así los reportes lo suman con las sueltas. */
  productId?: string | null;
}

export type OptionsOutcome = { ok: true; options: ResolvedOption[]; unitExtra: number } | { ok: false; message: string };

export const EMPTY_CATALOG: ModifierCatalog = { groupsByProduct: new Map(), groups: new Map(), options: new Map() };

const isActive = (v: boolean | number | null | undefined): boolean => v !== false && v !== 0;
const MAX_LISTED = 8;
const list = (names: readonly string[]): string =>
  names.length > MAX_LISTED ? `${names.slice(0, MAX_LISTED).join(", ")}…` : names.join(", ");

export function buildModifierCatalog(input: {
  groups: readonly ModifierGroupRow[];
  options: readonly ModifierOptionRow[];
  productGroups: readonly ProductGroupRow[];
}): ModifierCatalog {
  const groupsByProduct = new Map<number, number[]>();
  for (const pg of input.productGroups) groupsByProduct.set(pg.product_fudo_id, [...(groupsByProduct.get(pg.product_fudo_id) ?? []), pg.group_fudo_id]);
  return {
    groupsByProduct,
    groups: new Map(input.groups.map((g) => [g.fudo_id, g])),
    options: new Map(input.options.map((o) => [o.fudo_id, o])),
  };
}

/** Une opciones repetidas (suma qty) y las ordena por id: dos líneas con los mismos gustos tienen la misma clave. */
export function normalizeOptions(options: readonly LineOptionInput[] | undefined): LineOptionInput[] {
  const merged = new Map<number, number>();
  for (const o of options ?? []) merged.set(o.option_id, (merged.get(o.option_id) ?? 0) + o.qty);
  return [...merged.entries()].sort((a, b) => a[0] - b[0]).map(([option_id, qty]) => ({ option_id, qty }));
}

export const optionsKey = (options: readonly LineOptionInput[] | undefined): string =>
  normalizeOptions(options).map((o) => `${o.option_id}x${o.qty}`).join(",");

export interface ValidateArgs {
  productName: string;
  productFudoId: number | null;
  isDocena: boolean;
  docenaUnits: number;
  options: readonly LineOptionInput[] | undefined;
}

/**
 * Valida las opciones de UNA línea contra el catálogo y calcula lo que suman al precio unitario.
 * Los mensajes están en español y los puede mostrar el bot tal cual (sin código: se muestran como motivo).
 */
export function validateLineOptions(args: ValidateArgs, catalog: ModifierCatalog): OptionsOutcome {
  const { productName, productFudoId, isDocena, docenaUnits } = args;
  const chosen = normalizeOptions(args.options);
  const groupIds = productFudoId === null ? [] : [...(catalog.groupsByProduct.get(productFudoId) ?? [])];
  const activeIn = (groupId: number): ModifierOptionRow[] =>
    [...catalog.options.values()].filter((o) => o.group_fudo_id === groupId && isActive(o.is_active)).sort((a, b) => (a.position ?? 0) - (b.position ?? 0));

  if (chosen.length > 0 && groupIds.length === 0) return { ok: false, message: `«${productName}» no lleva opciones a elegir.` };

  const resolved: ResolvedOption[] = [];
  for (const c of chosen) {
    if (!Number.isInteger(c.option_id) || !Number.isInteger(c.qty) || c.qty < 1) {
      return { ok: false, message: `Las cantidades de las opciones de «${productName}» tienen que ser enteros mayores a 0.` };
    }
    const row = catalog.options.get(c.option_id);
    if (!row || !isActive(row.is_active) || !groupIds.includes(row.group_fudo_id)) {
      const valid = groupIds.flatMap((g) => activeIn(g).map((o) => o.name));
      return { ok: false, message: `Una opción elegida no corresponde a «${productName}». Opciones válidas: ${list(valid)}.` };
    }
    resolved.push({ option_id: row.fudo_id, group_fudo_id: row.group_fudo_id, product_fudo_id: row.product_fudo_id, name: row.name, qty: c.qty, price: row.price_cents / 100 });
  }

  const total = resolved.reduce((sum, o) => sum + o.qty, 0);
  if (isDocena) {
    if (total !== docenaUnits) {
      const names = groupIds.flatMap((g) => activeIn(g).map((o) => o.name));
      const head = total < docenaUnits ? "Faltan gustos de la docena" : "Sobran gustos en la docena";
      return { ok: false, message: `${head}: elegí ${docenaUnits} en total (hay ${total}).${names.length ? ` Gustos: ${list(names)}.` : ""}` };
    }
  } else {
    for (const groupId of groupIds) {
      const group = catalog.groups.get(groupId);
      const available = activeIn(groupId);
      if (!group || available.length === 0) continue;
      const inGroup = resolved.filter((o) => o.group_fudo_id === groupId).reduce((sum, o) => sum + o.qty, 0);
      const min = group.min_qty;
      const max = group.max_qty;
      if (min !== null && min > 0 && inGroup < min) {
        return { ok: false, message: `Para «${productName}» elegí ${min} de «${group.name}»: ${list(available.map((o) => o.name))}.` };
      }
      if (max !== null && inGroup > max) {
        return { ok: false, message: `Para «${productName}» podés elegir hasta ${max} de «${group.name}»: ${list(available.map((o) => o.name))}.` };
      }
    }
  }

  const unitExtra = resolved.reduce((sum, o) => sum + o.price * o.qty, 0);
  return { ok: true, options: resolved, unitExtra: Math.round(unitExtra * 100) / 100 };
}

/** "12 Carne, 6 Jamón y queso": para la descripción del pedido. */
export function describeOptions(options: ReadonlyArray<{ name: string; qty: number }>): string {
  return options.map((o) => `${o.qty} ${o.name}`).join(", ");
}
