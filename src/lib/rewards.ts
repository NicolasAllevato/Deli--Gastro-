import { formatMoney, type Reward } from "./orders.ts";

/** Línea de pedido con la categoría de su producto, lo que hace falta para valuar un canje. */
export interface RewardLine {
  qty: number;
  price: number;
  categoria: string | null;
}

export type RewardOutcome =
  | { ok: true; discount: number }
  | { ok: false; message: string };

/** Prefijos del historial de puntos: identifican canjes y devoluciones sin una columna nueva. */
export const REDEEM_PREFIX = "Canje: ";
export const REFUND_PREFIX = "Devolución: ";

const normalize = (text: string): string =>
  text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/**
 * Descuento que da una recompensa sobre un pedido. Nunca supera el subtotal ni toca el envío.
 * Los productos gratis descuentan una unidad: la más cara de la categoría (con tope si lo hay).
 */
export function applyReward(reward: Reward, lines: readonly RewardLine[], subtotal: number): RewardOutcome {
  const { efecto } = reward;

  if (efecto.tipo === "porcentaje") {
    return { ok: true, discount: Math.min(subtotal, Math.round((subtotal * efecto.porcentaje) / 100)) };
  }

  const wanted = normalize(efecto.categoria);
  const prices = lines.filter((l) => l.categoria !== null && normalize(l.categoria) === wanted && l.qty > 0).map((l) => l.price);
  if (prices.length === 0) {
    return { ok: false, message: `Para usar "${reward.nombre}" agregá un producto de ${efecto.categoria.toLowerCase()} a tu pedido.` };
  }

  const unit = Math.max(...prices);
  const discount = Math.min(subtotal, efecto.tope === undefined ? unit : Math.min(unit, efecto.tope));
  return { ok: true, discount };
}

/** Texto para la aclaración del pedido: la cocina y el cliente ven qué canje se aplicó. */
export function rewardNote(reward: Reward, discount: number): string {
  return `Canje de puntos: ${reward.nombre} (-${formatMoney(discount)})`;
}
