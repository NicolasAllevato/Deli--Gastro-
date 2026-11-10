/**
 * Día de trabajo de un repartidor (migración 029). Sin imports: lo usan la app y el Worker de Fudo.
 * Argentina está en UTC-3 todo el año. El día cambia a las 06:00, así un turno que sigue después de
 * medianoche conserva la habilitación.
 */

const ARGENTINA_OFFSET_HOURS = 3;
export const SHIFT_DAY_STARTS_AT_HOUR = 6;

/** Fecha `YYYY-MM-DD` del día de trabajo al que pertenece `now`. */
export function shiftDay(now: Date = new Date()): string {
  const shifted = now.getTime() - (ARGENTINA_OFFSET_HOURS + SHIFT_DAY_STARTS_AT_HOUR) * 3_600_000;
  return new Date(shifted).toISOString().slice(0, 10);
}

export type ShiftStatus = "pending" | "approved" | "rejected";

/** El único repartidor habilitado, o `null` si hay ninguno o más de uno. */
export function soleCourier(approvedNames: readonly string[]): string | null {
  const unique = [...new Set(approvedNames)];
  return unique.length === 1 ? unique[0] : null;
}
