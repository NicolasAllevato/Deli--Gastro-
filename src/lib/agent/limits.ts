/** Topes de mensajes entrantes por conversación: protegen el costo de IA ante spam o bucles. */
export const LIMITS = { perMinute: 12, perDay: 300 } as const;

export interface InboundCounts {
  /** Mensajes entrantes de la conversación en el último minuto (incluye el actual). */
  lastMinute: number;
  /** Mensajes entrantes de la conversación en las últimas 24 h (incluye el actual). */
  lastDay: number;
}

export type InboundDecision = "ok" | "notify" | "silent";

/**
 * Qué hacer con el mensaje actual. Se avisa al cliente solo en el mensaje que cruza el tope
 * (el siguiente ya es "silent"), para no responder cada mensaje de un spammer.
 */
export function decideInboundLimit(counts: InboundCounts): InboundDecision {
  // El tope diario manda: una vez superado no se vuelve a avisar por el tope por minuto.
  if (counts.lastDay === LIMITS.perDay + 1) return "notify";
  if (counts.lastDay > LIMITS.perDay) return "silent";
  if (counts.lastMinute === LIMITS.perMinute + 1) return "notify";
  if (counts.lastMinute > LIMITS.perMinute) return "silent";
  return "ok";
}
