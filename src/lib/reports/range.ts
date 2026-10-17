/** Argentina está en UTC-3 todo el año (sin horario de verano). */
const OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type RangeKey = "today" | "yesterday" | "last_7_days" | "last_30_days" | "this_month" | "last_month";

export const RANGE_KEYS: readonly RangeKey[] = [
  "today", "yesterday", "last_7_days", "last_30_days", "this_month", "last_month",
];

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  last_7_days: "Últimos 7 días",
  last_30_days: "Últimos 30 días",
  this_month: "Este mes",
  last_month: "Mes pasado",
};

/** Período [from, to): `from` inclusive, `to` exclusivo, en ISO UTC. */
export interface Bounds {
  from: string;
  to: string;
}

const startOfLocalDay = (ms: number) => Math.floor((ms - OFFSET_MS) / DAY_MS) * DAY_MS + OFFSET_MS;

function startOfLocalMonth(ms: number, monthsFromNow: number): number {
  const local = new Date(ms - OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + monthsFromNow, 1) + OFFSET_MS;
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Límites de un período calculados con el día y el mes de Buenos Aires. */
export function rangeBounds(range: RangeKey, now: Date = new Date()): Bounds {
  const ms = now.getTime();
  const today = startOfLocalDay(ms);

  switch (range) {
    case "today":
      return { from: iso(today), to: iso(today + DAY_MS) };
    case "yesterday":
      return { from: iso(today - DAY_MS), to: iso(today) };
    case "last_7_days":
      return { from: iso(today - 6 * DAY_MS), to: iso(today + DAY_MS) };
    case "last_30_days":
      return { from: iso(today - 29 * DAY_MS), to: iso(today + DAY_MS) };
    case "this_month":
      return { from: iso(startOfLocalMonth(ms, 0)), to: iso(startOfLocalMonth(ms, 1)) };
    case "last_month":
      return { from: iso(startOfLocalMonth(ms, -1)), to: iso(startOfLocalMonth(ms, 0)) };
  }
}

/** Fecha local (AAAA-MM-DD) de un instante, para agrupar por día. */
export function localDateKey(isoDate: string): string {
  return new Date(new Date(isoDate).getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

export function inBounds(isoDate: string, bounds: Bounds): boolean {
  const t = new Date(isoDate).getTime();
  return t >= new Date(bounds.from).getTime() && t < new Date(bounds.to).getTime();
}
