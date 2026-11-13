/**
 * Lógica pura de la vista de Conversaciones: filtros de la lista, ventana de 24 h de Meta y
 * agrupación de mensajes por día. Inspirado en el sidebar de chats de OpenWA (MIT).
 */

import { isBotPausedUntil } from "../../../../lib/whatsapp/pause.ts";
import { formatDateAR, formatTimeAR } from "../../../../lib/time-ar.ts";

export interface ConversationItem {
  id: string;
  phone: string;
  name: string;
  humanTakeover: boolean;
  /** Pausa del bot por un mensaje escrito desde la app WhatsApp Business (ISO). */
  botPausedUntil?: string | null;
  lastInboundAt: string | null;
  last: { direction: string; text: string; at: string } | null;
}

export interface ThreadMessage {
  id: string;
  direction: "in" | "out";
  type: string;
  body: string | null;
  status: string | null;
  tokens: number | null;
  created_at: string;
}

export type ConversationFilter = "todas" | "agente" | "persona" | "abiertas";

export const CONVERSATION_FILTERS: { id: ConversationFilter; label: string }[] = [
  { id: "todas", label: "Todas" },
  { id: "agente", label: "Agente" },
  { id: "persona", label: "Persona" },
  { id: "abiertas", label: "Ventana abierta" },
];

/** Meta solo deja escribir texto libre hasta 24 h después del último mensaje del cliente. */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Milisegundos que le quedan a la ventana de 24 h, o 0 si está cerrada o nunca escribió. */
export function windowRemainingMs(lastInboundAt: string | null, now: number): number {
  if (!lastInboundAt) return 0;
  const started = Date.parse(lastInboundAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, started + SERVICE_WINDOW_MS - now);
}

export function isWindowOpen(lastInboundAt: string | null, now: number): boolean {
  return windowRemainingMs(lastInboundAt, now) > 0;
}

/** "18 h", "45 min" o "menos de 1 min" para mostrar cuánto queda de ventana. */
export function formatRemaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes >= 60) return `${Math.floor(minutes / 60)} h`;
  if (minutes >= 1) return `${minutes} min`;
  return "menos de 1 min";
}

/** Una persona atiende: tomó el control desde el panel o hay una pausa por eco vigente. */
export function personAttends(c: { humanTakeover: boolean; botPausedUntil?: string | null }, now: number): boolean {
  return c.humanTakeover || isBotPausedUntil(c.botPausedUntil, now);
}

/** Texto de estado del chat para el encabezado. */
export function attendedLabel(c: { humanTakeover: boolean; botPausedUntil?: string | null }, now: number): string {
  if (c.humanTakeover) return "Atiende una persona (el agente no responde)";
  if (isBotPausedUntil(c.botPausedUntil, now)) {
    const time = formatTimeAR(c.botPausedUntil as string, { hour: "2-digit", minute: "2-digit", hour12: false });
    return `Bot en pausa hasta ${time}`;
  }
  return "Responde el agente";
}

const digits = (s: string) => s.replace(/\D/g, "");

export function filterConversations(
  list: readonly ConversationItem[],
  filter: ConversationFilter,
  query: string,
  now: number,
): ConversationItem[] {
  const q = query.trim().toLowerCase();
  const qDigits = digits(q);
  return list.filter((c) => {
    if (filter === "agente" && personAttends(c, now)) return false;
    if (filter === "persona" && !personAttends(c, now)) return false;
    if (filter === "abiertas" && !isWindowOpen(c.lastInboundAt, now)) return false;
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      (qDigits.length > 0 && c.phone.includes(qDigits)) ||
      (c.last?.text.toLowerCase().includes(q) ?? false)
    );
  });
}

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });

export interface DayGroup {
  day: string;
  messages: ThreadMessage[];
}

/** Agrupa mensajes consecutivos por día de Buenos Aires, respetando el orden recibido. */
export function groupByDay(messages: readonly ThreadMessage[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const m of messages) {
    const day = DAY_KEY.format(new Date(m.created_at));
    const current = groups[groups.length - 1];
    if (current && current.day === day) current.messages.push(m);
    else groups.push({ day, messages: [m] });
  }
  return groups;
}

/** "Hoy", "Ayer" o la fecha larga para el separador de día. */
export function dayLabel(day: string, now: number): string {
  const today = DAY_KEY.format(new Date(now));
  const yesterday = DAY_KEY.format(new Date(now - 24 * 60 * 60 * 1000));
  if (day === today) return "Hoy";
  if (day === yesterday) return "Ayer";
  return formatDateAR(`${day}T12:00:00-03:00`, { weekday: "long", day: "numeric", month: "long" });
}
