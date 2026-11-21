/**
 * Cómo se muestran los errores aprendidos en /admin/conocimiento (puro, sin React): tres grupos según el estado y
 * una línea corta por error para no llenar la pantalla con lo ya decidido.
 */

export type ErrorEstado = "pendiente" | "aprobada" | "rechazada" | "desactivada";

export interface ErroresAgrupados<T> {
  /** Esperan decisión: se muestran completos, con sus botones. */
  pendientes: T[];
  /** Lecciones activas (las que recibe el bot): una línea cada una. */
  aprobados: T[];
  /** Rechazadas y desactivadas, plegadas: se pueden reabrir. */
  historial: T[];
}

/** Reparte los errores por estado conservando el orden de entrada (el servidor ya los ordena por frecuencia). */
export function groupErrores<T extends { estado: ErrorEstado }>(errores: readonly T[]): ErroresAgrupados<T> {
  return {
    pendientes: errores.filter((e) => e.estado === "pendiente"),
    aprobados: errores.filter((e) => e.estado === "aprobada"),
    historial: errores.filter((e) => e.estado === "rechazada" || e.estado === "desactivada"),
  };
}

/** Una sola línea (sin saltos ni espacios repetidos), cortada en `max` caracteres con «…» si no entra. */
export function oneLine(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…` : flat;
}
