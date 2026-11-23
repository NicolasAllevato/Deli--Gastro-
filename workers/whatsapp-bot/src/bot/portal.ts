/**
 * Recordatorio del portal del local: cuando el cliente consulta precios, productos o delivery, de vez en cuando se le suma una línea
 * para pedir directo desde la web. La frecuencia la decide el código (no el modelo): como mucho una vez cada N horas por conversación
 * (`bot_portal_recordatorio_horas`, 24 por defecto; 0 lo apaga).
 */
import type { HistoryItem } from "../repo/types.ts";

export const PORTAL_IDLE_KEY = "bot_portal_recordatorio_horas";
export const DEFAULT_PORTAL_HOURS = 24;
const MAX_PORTAL_HOURS = 24 * 365;

/** Línea fija con el link al portal (la app expone `/cliente`). */
export const PORTAL_LINE = (appUrl: string): string => `También podés pedir directo desde nuestra web: ${appUrl.replace(/\/+$/, "")}/cliente`;

const PORTAL_MARK = "También podés pedir directo desde nuestra web";

/** Horas entre recordatorios; 0 = apagado; inválido o negativo = 24. */
export function portalIdleHours(config: Record<string, unknown>): number {
  const raw = config[PORTAL_IDLE_KEY];
  const n = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return DEFAULT_PORTAL_HOURS;
  return Math.min(n, MAX_PORTAL_HOURS);
}

/** true si corresponde agregar la línea: está encendido y el bot no la mandó en las últimas `hours` horas (sin hora conocida cuenta como reciente). */
export function portalReminderDue(recent: readonly HistoryItem[], now: number, hours: number): boolean {
  if (hours <= 0) return false;
  const limit = now - hours * 3_600_000;
  return !recent.some((m) => m.direction === "out" && m.body.includes(PORTAL_MARK) && (m.at === undefined || m.at.getTime() >= limit));
}
