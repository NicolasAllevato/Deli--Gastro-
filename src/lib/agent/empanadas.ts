import type { LineOptionInput, ModifierOptionRow } from "../order-options.ts";
import { normalizeOptions } from "../order-options.ts";

/**
 * Empaquetado de empanadas sueltas en docenas. Lógica pura: el bot manda empanadas sueltas por gusto y el
 * servidor arma las docenas (más baratas) con los gustos como opciones. Lo que sobra (< 1 docena) queda suelto.
 */

export interface PackLine {
  product_id: string;
  qty: number;
  options?: LineOptionInput[];
}

export interface PackContext {
  docenaProductId: string;
  docenaUnits: number;
  /** products.id de la empanada suelta → option_id (fudo_modifier_options.fudo_id) del gusto en la docena. */
  looseToOption: ReadonlyMap<string, number>;
}

export interface PackSource {
  docenaFudoId: number;
  docenaUnits: number;
  /** id Fudo de la empanada suelta → id Fudo del producto-sabor equivalente en el grupo de la docena. */
  gustosMap: Readonly<Record<string, number>>;
  products: ReadonlyArray<{ id: string; fudo_id: number | null }>;
  /** Opciones del/los grupo(s) asociados a la docena. */
  docenaOptions: readonly ModifierOptionRow[];
}

/** Resuelve ids Fudo ↔ uuid de products. `null` si falta el producto docena, la config o algún dato (no se empaqueta). */
export function buildPackContext(src: PackSource): PackContext | null {
  if (!Number.isInteger(src.docenaUnits) || src.docenaUnits < 1) return null;
  const docena = src.products.find((p) => p.fudo_id === src.docenaFudoId);
  if (!docena) return null;
  const optionBySabor = new Map<number, number>();
  for (const o of src.docenaOptions) {
    if (o.is_active === false || o.is_active === 0) continue;
    if (!optionBySabor.has(o.product_fudo_id)) optionBySabor.set(o.product_fudo_id, o.fudo_id);
  }
  const looseToOption = new Map<string, number>();
  for (const [looseFudoId, saborFudoId] of Object.entries(src.gustosMap)) {
    const loose = src.products.find((p) => p.fudo_id !== null && String(p.fudo_id) === looseFudoId);
    const option = optionBySabor.get(Number(saborFudoId));
    if (loose && option !== undefined) looseToOption.set(loose.id, option);
  }
  return looseToOption.size === 0 ? null : { docenaProductId: docena.id, docenaUnits: src.docenaUnits, looseToOption };
}

/**
 * Suma las empanadas sueltas por gusto; con al menos una docena arma `floor(N / unidades)` docenas llenándolas en
 * orden de aparición de los gustos. Docenas con los mismos gustos se fusionan en una línea con `qty` mayor.
 * El resto queda como sueltas por gusto. Las demás líneas (también una docena que ya trae opciones) pasan intactas.
 * Idempotente: volver a pasarle el resultado no cambia nada.
 */
export function packEmpanadas(lines: readonly PackLine[], ctx: PackContext | null): PackLine[] {
  if (!ctx) return [...lines];
  const isLoose = (l: PackLine): boolean => ctx.looseToOption.has(l.product_id) && (l.options?.length ?? 0) === 0;

  // Gustos en orden de aparición, con su cantidad total.
  const counts = new Map<string, number>();
  for (const l of lines) if (isLoose(l)) counts.set(l.product_id, (counts.get(l.product_id) ?? 0) + l.qty);
  const total = [...counts.values()].reduce((sum, n) => sum + n, 0);
  if (total < ctx.docenaUnits) return [...lines];

  const remaining = [...counts.entries()].map(([productId, qty]) => ({ productId, qty }));
  const docenas = new Map<string, { options: LineOptionInput[]; qty: number }>();
  for (let d = Math.floor(total / ctx.docenaUnits); d > 0; d--) {
    let need = ctx.docenaUnits;
    const picked = new Map<number, number>();
    for (const slot of remaining) {
      if (need === 0) break;
      const take = Math.min(slot.qty, need);
      if (take === 0) continue;
      slot.qty -= take;
      need -= take;
      const option = ctx.looseToOption.get(slot.productId)!;
      picked.set(option, (picked.get(option) ?? 0) + take);
    }
    const options = normalizeOptions([...picked.entries()].map(([option_id, qty]) => ({ option_id, qty })));
    const key = options.map((o) => `${o.option_id}x${o.qty}`).join(",");
    docenas.set(key, { options, qty: (docenas.get(key)?.qty ?? 0) + 1 });
  }

  const packed: PackLine[] = [
    ...[...docenas.values()].map((d) => ({ product_id: ctx.docenaProductId, qty: d.qty, options: d.options })),
    ...remaining.filter((r) => r.qty > 0).map((r) => ({ product_id: r.productId, qty: r.qty })),
  ];
  // Lo empaquetado va donde estaba la primera suelta; el resto del pedido conserva su orden.
  const out: PackLine[] = [];
  let placed = false;
  for (const l of lines) {
    if (!isLoose(l)) out.push(l);
    else if (!placed) {
      out.push(...packed);
      placed = true;
    }
  }
  return out;
}
