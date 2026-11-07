/**
 * Cuándo terminó realmente un pedido. Los de Fudo no siempre tienen `delivered_at`: ahí `updated_at` marca
 * el cierre con la demora de la sincronización (5 min), pero las importaciones masivas lo pisan con la hora
 * de la corrida. Por eso solo se acepta si da una duración creíble.
 */
export const MAX_PLAUSIBLE_MINUTES = 240;

const MINUTE_MS = 60_000;

export interface TimedOrder {
  status: string;
  created_at: string;
  ready_at: string | null;
  delivered_at: string | null;
  updated_at?: string | null;
  fudo_sale_type?: string | null;
}

export interface FinishedStats {
  avgMinutes: number | null;
  /** % de los pedidos medidos que terminaron dentro del objetivo. */
  onTargetPct: number | null;
  measured: number;
}

/** Minutos entre dos fechas; null si faltan o están invertidas. */
export function minutesBetween(from: string, to: string | null | undefined): number | null {
  if (!to) return null;
  const minutes = (Date.parse(to) - Date.parse(from)) / MINUTE_MS;
  return Number.isFinite(minutes) && minutes >= 0 ? minutes : null;
}

export function completedAt(order: TimedOrder): string | null {
  if (order.delivered_at) return order.delivered_at;
  if (order.status !== "Finalizados") return null;
  const minutes = minutesBetween(order.created_at, order.updated_at);
  return minutes !== null && minutes <= MAX_PLAUSIBLE_MINUTES ? (order.updated_at as string) : null;
}

/** Fin de la preparación. En take away el pedido se cierra al retirarlo; en delivery incluiría el viaje. */
export function preparedAt(order: TimedOrder): string | null {
  if (order.ready_at) return order.ready_at;
  return order.fudo_sale_type === "TAKEAWAY" ? completedAt(order) : null;
}

/** Tiempo promedio y % dentro del objetivo de una lista de duraciones en minutos. */
export function durationStats(minutes: readonly number[], targetMinutes: number): FinishedStats {
  if (minutes.length === 0) return { avgMinutes: null, onTargetPct: null, measured: 0 };
  const onTarget = minutes.filter((m) => m <= targetMinutes).length;
  return {
    avgMinutes: Math.round((minutes.reduce((a, b) => a + b, 0) / minutes.length) * 10) / 10,
    onTargetPct: Math.round((onTarget / minutes.length) * 1000) / 10,
    measured: minutes.length,
  };
}

/** Del pedido a su cierre, solo para los que se pueden medir. */
export function finishedStats(orders: readonly TimedOrder[], targetMinutes: number): FinishedStats {
  const minutes = orders
    .map((o) => minutesBetween(o.created_at, completedAt(o)))
    .filter((m): m is number => m !== null);
  return durationStats(minutes, targetMinutes);
}
