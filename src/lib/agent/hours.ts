const DEFAULT_TIME_ZONE = "America/Argentina/Buenos_Aires";
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

const toMinutes = (hhmm: string): number | null => {
  const match = TIME.exec(hhmm);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

function localMinutes(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false })
    .formatToParts(now);
  const hour = Number(parts.find((p) => p.type === "hour")?.value) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value);
  return hour * 60 + minute;
}

/**
 * ¿Está abierto el local ahora? Admite horarios que cruzan la medianoche (18:00–02:00).
 * Si el horario configurado no es válido no se bloquea nada: se considera abierto.
 */
export function isOpenNow(open: string, close: string, now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): boolean {
  const from = toMinutes(open);
  const to = toMinutes(close);
  if (from === null || to === null || from === to) return true;

  const current = localMinutes(now, timeZone);
  return from < to ? current >= from && current < to : current >= from || current < to;
}
