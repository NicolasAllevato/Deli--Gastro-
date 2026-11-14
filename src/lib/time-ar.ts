/**
 * Única forma de MOSTRAR fechas y horas en la app: siempre en hora argentina,
 * se renderice en el servidor (Worker, en UTC) o en el navegador (cualquier
 * zona). Antes, toLocale*String("es-AR") sin timeZone mostraba la hora UTC en
 * las páginas del servidor: 18:23Z salía 6:23 p. m. en vez de 3:23 p. m.
 * tests/time-ar.test.ts falla si aparece un toLocale*String de fecha fuera de acá.
 * Solo presentación: los datos se guardan y viajan en UTC ISO, sin cambios.
 */
export const AR_TZ = "America/Argentina/Buenos_Aires";
export const AR_LOCALE = "es-AR";

export type DateInput = Date | string | number;

function toDate(value: DateInput): Date {
  return value instanceof Date ? value : new Date(value);
}

/** Igual que Date#toLocaleString("es-AR", opts) pero en hora argentina. */
export function formatDateTimeAR(value: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return toDate(value).toLocaleString(AR_LOCALE, { ...opts, timeZone: AR_TZ });
}

/** Igual que Date#toLocaleDateString("es-AR", opts) pero en hora argentina. */
export function formatDateAR(value: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return toDate(value).toLocaleDateString(AR_LOCALE, { ...opts, timeZone: AR_TZ });
}

/** Igual que Date#toLocaleTimeString("es-AR", opts) pero en hora argentina. */
export function formatTimeAR(value: DateInput, opts: Intl.DateTimeFormatOptions = {}): string {
  return toDate(value).toLocaleTimeString(AR_LOCALE, { ...opts, timeZone: AR_TZ });
}

const DAY_KEY = new Intl.DateTimeFormat("en-CA", { timeZone: AR_TZ, year: "numeric", month: "2-digit", day: "2-digit" });

/** Día argentino 'YYYY-MM-DD' de un instante (para comparar "es hoy"). */
export function dayKeyAR(value: DateInput): string {
  return DAY_KEY.format(toDate(value));
}

/**
 * Medianoche argentina de un día 'YYYY-MM-DD' (+ offsetDays). Argentina usa
 * UTC-3 fijo, sin horario de verano desde 2009 (igual que reports/range.ts y
 * daily-summary).
 */
export function startOfDayKeyAR(dayKey: string, offsetDays = 0): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) throw new Error("Día inválido");
  return new Date(new Date(`${dayKey}T00:00:00-03:00`).getTime() + offsetDays * 86_400_000);
}

/** Medianoche argentina del día en que cae `value` (+ offsetDays). */
export function startOfDayAR(value: DateInput, offsetDays = 0): Date {
  return startOfDayKeyAR(dayKeyAR(value), offsetDays);
}

/** ¿Los dos instantes caen el mismo día en Argentina? */
export function isSameDayAR(a: DateInput, b: DateInput): boolean {
  return dayKeyAR(a) === dayKeyAR(b);
}
