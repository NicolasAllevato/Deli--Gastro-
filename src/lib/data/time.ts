/**
 * Fechas: en D1 todo se guarda en UTC ISO-8601 ('2026-11-12T15:04:05.123Z').
 * La ÚNICA conversión a hora argentina vive acá (SQLite no tiene zonas).
 */
export const AR_TIME_ZONE = "America/Argentina/Buenos_Aires";

const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: AR_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Día local argentino 'YYYY-MM-DD' de un instante. */
export function argentinaDay(instant: Date | string = new Date()): string {
  const d = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");
  return dayFormatter.format(d);
}

/**
 * Rango UTC [desde, hasta) que cubre un día argentino completo, para filtrar
 * columnas ISO con `created_at >= ? AND created_at < ?`.
 * Argentina usa UTC-3 fijo (sin horario de verano desde 2009); se calcula con
 * Intl igualmente para no depender de esa suposición.
 */
export function argentinaDayRangeUtc(day: string): { from: string; to: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Día inválido");
  const [y, m, d] = day.split("-").map(Number);
  const from = localMidnightUtc(y, m, d);
  const to = localMidnightUtc(y, m, d + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

function localMidnightUtc(y: number, m: number, d: number): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  const offsetMin = offsetMinutes(guess);
  return new Date(guess.getTime() - offsetMin * 60_000);
}

/** Minutos que la hora argentina adelanta (negativo: atrasa) respecto de UTC. */
function offsetMinutes(at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: AR_TIME_ZONE,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60_000);
}

export function toUtcIso(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(d.getTime())) throw new Error("Fecha inválida");
  return d.toISOString();
}
