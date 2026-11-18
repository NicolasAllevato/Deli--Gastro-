import { isOpenNow } from "../agent/hours.ts";

/** Un reclamo abierto (sin tomar) por más de 2 h con el local abierto se marca como vencido. */
export const SLA_MS = 2 * 60 * 60 * 1000;
const AR_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface Horario {
  open: string;
  close: string;
  paused?: boolean;
}

/** Instante (UTC) en que abrió el local en el turno actual; null si ahora está cerrado. */
export function aperturaActual(horario: Horario, now: Date): Date | null {
  if (horario.paused || !isOpenNow(horario.open, horario.close, now)) return null;
  const m = TIME.exec(horario.open);
  if (!m) return new Date(now.getTime() - DAY_MS); // horario inválido = siempre abierto
  const openMin = Number(m[1]) * 60 + Number(m[2]);
  const local = now.getTime() - AR_OFFSET_MS;
  const dayStart = Math.floor(local / DAY_MS) * DAY_MS;
  const localMin = Math.floor((local - dayStart) / 60_000);
  const openLocal = dayStart + openMin * 60_000 - (localMin < openMin ? DAY_MS : 0);
  return new Date(openLocal + AR_OFFSET_MS);
}

/**
 * Corte del SLA: un reclamo abierto creado antes de este instante está vencido. Cuenta solo tiempo con el
 * local abierto: un reclamo de la madrugada vence 2 h después de la apertura. null = nada puede estar vencido
 * (local cerrado o abrió hace menos de 2 h).
 */
export function slaCorte(horario: Horario, now: Date = new Date()): string | null {
  const apertura = aperturaActual(horario, now);
  if (!apertura) return null;
  // Abrió hace menos de 2 h: ningún reclamo lleva 2 h de local abierto.
  if (now.getTime() - apertura.getTime() < SLA_MS) return null;
  return new Date(now.getTime() - SLA_MS).toISOString();
}
