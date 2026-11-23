/**
 * Contexto por pedido: la conversación de WhatsApp de un cliente es una sola y no se borra, pero el modelo (y los chequeos
 * que miran el historial) solo ven la "sesión" actual. La sesión arranca en el primer mensaje del cliente que llega
 * después de (a) un mensaje del bot que cierra un pedido (confirmado, cancelado, descartado) o (b) un rato largo sin
 * actividad (resumen abandonado). Nada se borra: es un corte de lectura derivado de las horas de los mensajes.
 */
import type { HistoryItem } from "../repo/types.ts";

/** Clave de `global_config` con los minutos de inactividad que abandonan un pedido en armado. */
export const SESSION_IDLE_KEY = "bot_sesion_inactividad_min";
export const DEFAULT_SESSION_IDLE_MIN = 150;
const MAX_SESSION_IDLE_MIN = 7 * 24 * 60;

export interface TimedMessage extends HistoryItem {
  at: Date;
}

/** Mensajes del bot que dejan un pedido cerrado (el link de pago pendiente NO: ese pedido sigue en curso). */
const CLOSING = /^(¡Listo! Tu pedido quedó confirmado|Listo, (cancelamos|ya cancelamos|dejamos)|Tu pedido ya está cancelado)/;

export const closesOrder = (m: Pick<HistoryItem, "direction" | "body">): boolean => m.direction === "out" && CLOSING.test(m.body);

/** Milisegundos de inactividad que abandonan el pedido; inválido o menor a 1 minuto = 150 minutos. */
export function sessionIdleMs(config: Record<string, unknown>): number {
  const raw = config[SESSION_IDLE_KEY];
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  const minutes = typeof n === "number" && Number.isFinite(n) && n >= 1 ? Math.min(Math.floor(n), MAX_SESSION_IDLE_MIN) : DEFAULT_SESSION_IDLE_MIN;
  return minutes * 60_000;
}

/**
 * Hora del primer mensaje de la sesión actual, o null si no hay corte (toda la charla es una sola sesión).
 * `items` va del más viejo al más nuevo e incluye el mensaje del cliente que se está atendiendo.
 */
export function sessionStart(items: readonly TimedMessage[], idleMs: number): Date | null {
  let start: Date | null = null;
  let closed = false;
  items.forEach((cur, i) => {
    if (cur.direction === "in") {
      const prev = items[i - 1];
      if (closed || (prev && cur.at.getTime() - prev.at.getTime() > idleMs)) start = cur.at;
      closed = false;
    }
    if (closesOrder(cur)) closed = true;
  });
  return start;
}
