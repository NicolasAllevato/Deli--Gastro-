import type { OrderLine } from "@/lib/orders";

/** Fila de `order_items` tal como llega con `select("*")` (las columnas de Fudo existen desde la migración 031). */
export interface StoredItem {
  name: string;
  qty: number;
  fudo_product_id?: number | null;
  fudo_comment?: string | null;
  fudo_options?: ReadonlyArray<{ qty: number; name: string }> | null;
}

export interface DetailLine {
  qty: number;
  name: string;
  fudoProductId: number | null;
  options: ReadonlyArray<{ qty: number; name: string }>;
  /** Comentario original de Fudo cuando no coincide con el nombre mostrado (genéricos: "Combo para compartir - "). */
  originalText: string | null;
}

/** Líneas del detalle: las guardadas si hay; si no (pedidos viejos), las que salen de `items_desc`. */
export function detailLines(items: readonly StoredItem[], fallback: readonly OrderLine[]): DetailLine[] {
  if (items.length === 0) {
    return fallback.map((l) => ({ qty: l.qty, name: l.name, fudoProductId: null, options: l.options ?? [], originalText: null }));
  }
  return items.map((i) => {
    const comment = i.fudo_comment?.trim() || null;
    return {
      qty: i.qty,
      name: i.name,
      fudoProductId: i.fudo_product_id ?? null,
      options: Array.isArray(i.fudo_options) ? i.fudo_options : [],
      originalText: comment && comment !== i.name ? comment : null,
    };
  });
}
