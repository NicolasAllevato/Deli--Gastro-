import type { Reward } from "../orders.ts";

/** Fracción de la recompensa que puede faltar para considerarla "cerca" (25 %). */
const CLOSE_RATIO = 0.25;

export interface RedeemRecommendation {
  kind: "ready" | "close";
  reward: Reward;
  /** Puntos que faltan (0 si ya alcanza). */
  missing: number;
  /** Importe aproximado de compra para juntar lo que falta; null si no hay regla de puntos. */
  spendNeeded: number | null;
  message: string;
}

const pesos = (n: number) => `$${n.toLocaleString("es-AR")}`;

/**
 * Qué conviene decirle al cliente sobre sus puntos: si ya puede canjear, la recompensa más
 * valiosa a su alcance; si le falta poco, cuánto le falta y con qué compra lo consigue.
 */
export function redeemRecommendation(
  points: number,
  rewards: readonly Reward[],
  puntosPor100: number,
): RedeemRecommendation | null {
  const affordable = rewards.filter((r) => r.puntosRequeridos <= points).sort((a, b) => b.puntosRequeridos - a.puntosRequeridos)[0];
  if (affordable) {
    return {
      kind: "ready",
      reward: affordable,
      missing: 0,
      spendNeeded: null,
      message: `Tenés ${points} puntos: te alcanza para "${affordable.nombre}". Sumalo a tu próximo pedido y aprovechalo.`,
    };
  }

  const next = rewards.filter((r) => r.puntosRequeridos > points).sort((a, b) => a.puntosRequeridos - b.puntosRequeridos)[0];
  if (!next) return null;
  const missing = next.puntosRequeridos - points;
  if (missing > next.puntosRequeridos * CLOSE_RATIO) return null;

  const spendNeeded = puntosPor100 > 0 ? Math.ceil((missing / puntosPor100) * 100) : null;
  const how = spendNeeded ? ` Con un pedido de ${pesos(spendNeeded)} o más lo conseguís.` : "";
  return {
    kind: "close",
    reward: next,
    missing,
    spendNeeded,
    message: `Te faltan solo ${missing} puntos para "${next.nombre}".${how}`,
  };
}
