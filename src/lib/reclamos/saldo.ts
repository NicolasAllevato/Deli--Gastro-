/** Saldo a favor por reclamos (puro, sin base de datos): conversión del viejo «descuento %» a pesos. */

/** Tope por defecto del saldo que sugiere el agente (`reclamo_max_saldo`), en pesos. */
export const DEFAULT_MAX_SALDO = 10_000;
/** Tope duro de lo que el panel puede acreditar por reclamo: evita un cero de más por error. */
export const MAX_SALDO_PANEL = 100_000;

/** Pesos de saldo equivalentes a un % del total del pedido asociado (total en centavos). */
export function descuentoASaldoPesos(totalCents: number, pct: number): number {
  return Math.round(((totalCents / 100) * pct) / 100);
}

export const SIN_PEDIDO_PARA_DESCUENTO =
  "El reclamo no tiene un pedido asociado: no se puede convertir el descuento en pesos. Usá «Saldo a favor» y escribí el monto en pesos.";
