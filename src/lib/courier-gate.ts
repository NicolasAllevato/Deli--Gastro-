import type { UserRole } from "@/lib/auth/roles";

/**
 * Compuerta de habilitación diaria en `PATCH /api/orders` (migración 029), sin acceso a la base:
 * decide a QUIÉN hay que comprobar contra `isCourierApproved`. La ruta hace la consulta y responde.
 */

export interface CourierGateInput {
  role: UserRole;
  /** Nombre del repartidor que hace la llamada. Solo cuenta cuando `role` es "repartidor". */
  ownName: string;
  /** `courier_name` del cuerpo: `undefined` no lo toca, `null` desasigna. */
  requested: string | null | undefined;
  /** `courier_name` actual del pedido. */
  current: string | null;
}

/**
 * Nombre del repartidor que tiene que estar habilitado hoy para que el cambio proceda, o `null`
 * si no hace falta comprobar a nadie.
 * - Repartidor: tomar un pedido nuevo lo exige de sí mismo; entregar lo que ya lleva, no.
 * - Admin: asignar a otro lo exige del nombre pedido; desasignar, o dejar el que ya tiene, no.
 */
export function courierToVerify(input: CourierGateInput): string | null {
  if (input.requested === undefined) return null;
  if (input.role === "repartidor") return input.ownName;
  // Desasignar, o reenviar el mismo nombre que ya tiene el pedido, no entrega nada nuevo.
  if (input.requested === null || input.requested === input.current) return null;
  return input.requested;
}
