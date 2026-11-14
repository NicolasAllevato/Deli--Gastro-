import { parseItems } from "../orders.ts";
import { hasComboWord, isAdditionalPromo, stripPromoMarks } from "../promo-names.ts";
import { inBounds, type Bounds } from "./range.ts";

/**
 * Ventas por producto, en dos tablas:
 *  - **Combos**: solo combos, con su nombre real, unidades y monto (precio del combo × cantidad).
 *  - **Productos**: todo lo vendido como producto: los sueltos (con su monto) más los que vinieron DENTRO de un
 *    combo o de otro ítem (gustos de empanada, opcional genérico). Estos últimos suman unidades
 *    (cantidad del gusto × cantidad del combo) pero $0, porque el precio ya está en el combo: así el ranking por
 *    unidades los cuenta y la facturación no se duplica.
 *
 * Qué es un combo (cualquiera de estas; reglas en src/lib/promo-names.ts):
 *  - la línea tiene `is_combo` (lo marca el sync de Fudo);
 *  - la línea trae productos dentro (genérico de Fudo con gustos);
 *  - el nombre del producto, o el nombre/categoría del producto de la app (`ComboRules`), tiene "combo" o "promo"
 *    Y la línea se vendió a precio > $0.
 * Con "combo"/"promo" pero a $0 es un COMPONENTE: va a Productos a $0 con el nombre sin las marcas de promo
 * ("EMPANADA CARNE PROMO LIBRE" → "EMPANADA CARNE"; el sync de Fudo ya lo resuelve al producto real).
 * "(Adicional Promo)" es un producto normal.
 *
 * Agrupación: por `product_id` si existe; si no, por id de Fudo + nombre; si no, por nombre. Para mostrar, las
 * claves con el mismo nombre se juntan (un pedido viejo sin líneas y uno nuevo con product_id).
 */

export interface SalesOption {
  qty: number;
  name: string;
  product_id?: string | null;
  fudo_product_id?: number | null;
}

/** Línea de `order_items` tal como la trae `order_items(*)` (las columnas de Fudo existen desde la migración 031). */
export interface ReportLine {
  product_id: string | null;
  fudo_product_id?: number | null;
  name: string;
  qty: number;
  unit_price?: number | string | null;
  is_combo?: boolean | null;
  fudo_options?: ReadonlyArray<SalesOption> | null;
}

export interface SalesOrder {
  status: string;
  created_at: string;
  items_desc: string;
  order_items?: ReadonlyArray<ReportLine> | null;
}

export interface ComboRules {
  /** Productos de la app con "combo"/"promo" en el nombre o en la categoría (el precio se mira en cada venta). */
  comboProductIds: ReadonlySet<string>;
  /** Los mismos, por nombre normalizado (para pedidos viejos que solo tienen `items_desc`). */
  comboNames: ReadonlySet<string>;
}

export const NO_COMBO_RULES: ComboRules = { comboProductIds: new Set(), comboNames: new Set() };

export interface SalesRow {
  name: string;
  units: number;
  /** Monto: precio de la línea × cantidad; sin línea guardada, precio actual del producto. Los productos dentro de un combo suman $0. */
  revenue: number;
}

export interface ProductSales {
  combos: SalesRow[];
  products: SalesRow[];
}

export const normalizeProductName = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Categoría de combos: el nombre contiene "combo" o "promo" (Combos, Promos, Promociones…). */
export const isComboCategory = (name: string | null | undefined): boolean => hasComboWord(name);

/** Reglas de combos a partir de los productos de la app con el nombre de su categoría. */
export function buildComboRules(products: ReadonlyArray<{ id: string; name: string; category: string | null }>): ComboRules {
  const combos = products.filter((p) => !isAdditionalPromo(p.name) && (hasComboWord(p.name) || isComboCategory(p.category)));
  return { comboProductIds: new Set(combos.map((p) => p.id)), comboNames: new Set(combos.map((p) => normalizeProductName(p.name))) };
}

/** Clave de agrupación: producto de la app, si no producto de Fudo + nombre, si no nombre. */
export function productSalesKey(line: { product_id?: string | null; fudo_product_id?: number | null; name: string }): string {
  if (line.product_id) return `p:${line.product_id}`;
  if (line.fudo_product_id != null) return `f:${line.fudo_product_id}:${normalizeProductName(line.name)}`;
  return `n:${normalizeProductName(line.name)}`;
}

interface NormalLine {
  key: string;
  name: string;
  qty: number;
  /** null = sin precio guardado: se estima con el precio actual. */
  unitPrice: number | null;
  combo: boolean;
  options: SalesOption[];
}

function promoMarked(line: { product_id?: string | null; name: string }, rules: ComboRules): boolean {
  if (isAdditionalPromo(line.name)) return false;
  return hasComboWord(line.name) || (!!line.product_id && rules.comboProductIds.has(line.product_id)) || rules.comboNames.has(normalizeProductName(line.name));
}

function classify(
  base: { product_id?: string | null; fudo_product_id?: number | null; name: string; qty: number },
  unitPrice: number | null,
  explicitCombo: boolean,
  options: SalesOption[],
  rules: ComboRules,
  priceByName: ReadonlyMap<string, number>,
): NormalLine {
  const price = unitPrice ?? priceByName.get(base.name) ?? 0;
  const marked = promoMarked(base, rules);
  const combo = explicitCombo || options.length > 0 || (marked && price > 0);
  // Componente de promo a $0: se cuenta como producto con el nombre limpio.
  const name = !combo && marked && price === 0 ? stripPromoMarks(base.name) : base.name;
  return { key: productSalesKey({ ...base, name }), name, qty: base.qty, unitPrice, combo, options };
}

function linesOf(o: SalesOrder, rules: ComboRules, priceByName: ReadonlyMap<string, number>): NormalLine[] {
  if (o.order_items?.length) {
    return o.order_items.map((l) => {
      const price = l.unit_price == null ? null : Number(l.unit_price);
      return classify(l, Number.isFinite(price) ? price : null, l.is_combo === true, [...(l.fudo_options ?? [])], rules, priceByName);
    });
  }
  return parseItems(o.items_desc).map((l) => classify({ product_id: null, name: l.name, qty: l.qty }, null, false, l.options ?? [], rules, priceByName));
}

type Acc = Map<string, { name: string; units: number; revenue: number }>;

function add(acc: Acc, key: string, name: string, units: number, revenue: number): void {
  const cur = acc.get(key);
  acc.set(key, { name: cur?.name ?? name, units: (cur?.units ?? 0) + units, revenue: (cur?.revenue ?? 0) + revenue });
}

function rank(acc: Acc, limit: number): SalesRow[] {
  const byName = new Map<string, SalesRow>();
  for (const r of acc.values()) {
    const cur = byName.get(r.name);
    byName.set(r.name, { name: r.name, units: (cur?.units ?? 0) + r.units, revenue: (cur?.revenue ?? 0) + r.revenue });
  }
  return [...byName.values()]
    .map((r) => ({ ...r, revenue: Math.round(r.revenue * 100) / 100 }))
    .sort((a, b) => b.units - a.units || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Pedidos no cancelados dentro de `bounds` → tablas de Combos y Productos. */
export function productSales(
  orders: readonly SalesOrder[],
  bounds: Bounds,
  priceByName: ReadonlyMap<string, number>,
  limit: number,
  rules: ComboRules = NO_COMBO_RULES,
): ProductSales {
  const combos: Acc = new Map();
  const products: Acc = new Map();
  for (const o of orders) {
    if (o.status === "Cancelado" || !inBounds(o.created_at, bounds)) continue;
    for (const line of linesOf(o, rules, priceByName)) {
      const revenue = line.qty * (line.unitPrice ?? priceByName.get(line.name) ?? 0);
      if (line.combo) add(combos, line.key, line.name, line.qty, revenue);
      else add(products, line.key, line.name, line.qty, revenue);
      // Lo que vino dentro suma unidades (por cada combo) y $0: el precio está en el combo.
      for (const opt of line.options) add(products, productSalesKey(opt), opt.name, opt.qty * line.qty, 0);
    }
  }
  return { combos: rank(combos, limit), products: rank(products, limit) };
}
