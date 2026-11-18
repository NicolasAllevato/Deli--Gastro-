/**
 * Saludo de la primera vez (o tras un rato largo sin hablar) y promos del día.
 * Todo puro: lo usan el turno y los tests sin base ni modelo.
 */
import type { MenuItem } from "../repo/types.ts";
import { money } from "../orders/flow.ts";
import { openNow, type BotSettings } from "./settings.ts";

/** Si pasó más que esto desde el último mensaje del bot, la charla se considera nueva y se saluda de nuevo. */
export const GREETING_GAP_MS = 6 * 60 * 60 * 1000;
export const MAX_PROMOS = 5;
const TZ = "America/Argentina/Buenos_Aires";

const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** true = hay que saludar: el bot nunca respondió en esta conversación o su último mensaje es de hace más de 6 h. */
export function isNewConversation(lastOutboundAt: Date | null, now: number): boolean {
  return lastOutboundAt === null || now - lastOutboundAt.getTime() > GREETING_GAP_MS;
}

/** Primer nombre del cliente ("Tata Pérez" → "Tata"); null si no hay un nombre usable. */
export function firstName(name: string | null | undefined): string | null {
  const first = (name ?? "").trim().split(/\s+/)[0]?.replace(/[^\p{L}\p{M}'-]/gu, "") ?? "";
  return first.length >= 2 ? first.slice(0, 30) : null;
}

/** 0 = domingo ... 6 = sábado, en hora de Argentina. */
const DAYS: readonly string[] = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];

export function argentinaClock(now: Date): { weekday: number; hour: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: TZ, weekday: "short", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "Sun";
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  return { weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd), hour: hour % 24 };
}

/** Días que nombra el texto (ya normalizado). "Lunes a jueves" = rango; "finde"/"fin de semana" = viernes a domingo. */
export function daysMentioned(folded: string): Set<number> {
  const days = new Set<number>();
  const re = /\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\b(?:\s+(?:a|al)\s+\b(domingo|lunes|martes|miercoles|jueves|viernes|sabado)s?\b)?/g;
  for (const m of folded.matchAll(re)) {
    const from = DAYS.indexOf(m[1]);
    if (!m[2]) {
      days.add(from);
      continue;
    }
    const to = DAYS.indexOf(m[2]);
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d);
      if (d === to) break;
    }
  }
  if (/\bfinde\b|\bfin de semana\b/.test(folded)) [5, 6, 0].forEach((d) => days.add(d));
  return days;
}

/** Nombres que nunca son una promo para ofrecer (señas de eventos, adicionales). */
const EXCLUDED = /\bsena\b|\bsena evento\b|\badicional/;

/**
 * Promos de hoy: categoría "Promos" del catálogo (activas y visibles; ya filtradas por `repo.menu()`), que nombran el
 * día de hoy o ningún día. ALMUERZO solo antes de las 16, CENA desde las 18. Máximo 5, en el orden del catálogo.
 */
export function promosForToday(menu: readonly MenuItem[], now: Date): MenuItem[] {
  const { weekday, hour } = argentinaClock(now);
  return menu
    .filter((p) => /^promos?$/.test(fold(p.category).trim()))
    .filter((p) => {
      const name = fold(p.name);
      if (EXCLUDED.test(name)) return false;
      const days = daysMentioned(name);
      if (days.size > 0 && !days.has(weekday)) return false;
      if (/\balmuerzo/.test(name) && hour >= 16) return false;
      if (/\bcena\b/.test(name) && hour < 18) return false;
      return true;
    })
    .slice(0, MAX_PROMOS);
}

/** Promos en el formato que el modelo copia tal cual (price_text ya formateado). */
export function promosForModel(promos: readonly MenuItem[]): { name: string; price_text: string; description: string | null }[] {
  return promos.map((p) => ({ name: p.name, price_text: money(p.price), description: p.description }));
}

const oneLine = (s: string, max: number): string => s.replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Saludo fijo (no pasa por el modelo): nombre del cliente, nombre del agente y del local (de `global_config`),
 * qué puede hacer y las promos de hoy. No ofrece hablar con una persona: eso solo aparece ante una queja.
 */
export function renderGreeting(settings: BotSettings, customerName: string | null, promos: readonly MenuItem[], now: Date = new Date()): string {
  const name = firstName(customerName);
  const hello = name ? `¡Hola, ${name}! 👋` : "¡Hola! 👋";
  const who = settings.agentName ? `Soy ${settings.agentName}, el asistente de ${settings.businessName}.` : `Soy el asistente de ${settings.businessName}.`;
  const ask = openNow(settings, now)
    ? "Te ayudo con lo que necesites: consultame cualquier duda o armamos tu pedido. ¿Qué querés pedir hoy?"
    : `Te ayudo con lo que necesites: consultame cualquier duda. Ahora estamos cerrados; tomamos pedidos de ${settings.hours.open} a ${settings.hours.close}.`;
  const lines = [`${hello} ${who} ${ask}`];
  if (promos.length > 0) {
    lines.push("", "Promos de hoy:", ...promos.map((p) => `• ${oneLine(p.name, 80)} — ${money(p.price)}`));
  }
  return lines.join("\n");
}
