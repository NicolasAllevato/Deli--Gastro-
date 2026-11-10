import type { CourierShift } from "@/lib/courier-shifts";

export interface FreshPendingNotice {
  /** Texto para el lector de pantalla, o `null` si no hay solicitudes nuevas. */
  notice: string | null;
  /** Ids ya anunciados (los de antes más los de ahora). El conjunto recibido no se modifica. */
  seen: ReadonlySet<string>;
}

/**
 * Qué anunciar cuando el panel del local recarga las habilitaciones del día: solo las solicitudes
 * pendientes que todavía no se habían anunciado. Así el lector de pantalla no relee toda la lista
 * en cada refresco, sino únicamente cuando un repartidor nuevo pide que lo habiliten.
 */
export function freshPendingNotice(shifts: readonly CourierShift[], seen: ReadonlySet<string>): FreshPendingNotice {
  const fresh = shifts.filter((s) => s.status === "pending" && !seen.has(s.id));
  if (fresh.length === 0) return { notice: null, seen };
  const names = fresh.map((s) => s.courierName).join(", ");
  const notice = fresh.length === 1 ? `${names} espera que lo habilites hoy.` : `${names} esperan que los habilites hoy.`;
  return { notice, seen: new Set([...seen, ...fresh.map((s) => s.id)]) };
}
