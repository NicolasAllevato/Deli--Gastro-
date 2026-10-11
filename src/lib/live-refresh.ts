/**
 * Política de actualización de las pantallas que muestran pedidos.
 *
 * En producción llegan avisos en tiempo real (Supabase Broadcast, ver migración 010), así que
 * la consulta periódica queda solo como respaldo por si se corta la conexión. En modo demo no
 * hay Supabase: se consulta seguido, como antes.
 */

/** Respaldo cuando el aviso en tiempo real está activo. */
export const FALLBACK_POLL_MS = 30_000;

/** Junta ráfagas de avisos (varios cambios seguidos) en una sola consulta. */
export const PING_DEBOUNCE_MS = 250;

export const TOPIC_ALL_ORDERS = "orders";

export function orderTopic(orderId: string): string {
  return `order:${orderId}`;
}

export interface LivePlan {
  /** Si hay que suscribirse al canal en tiempo real. */
  subscribe: boolean;
  /** Cada cuánto consultar; null = no consultar periódicamente. */
  pollMs: number | null;
}

export function planLiveRefresh(options: { demo: boolean; enabled: boolean; demoPollMs: number }): LivePlan {
  if (!options.enabled) return { subscribe: false, pollMs: null };
  if (options.demo) return { subscribe: false, pollMs: options.demoPollMs };
  return { subscribe: true, pollMs: FALLBACK_POLL_MS };
}
