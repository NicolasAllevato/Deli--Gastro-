/**
 * Quién hace la consulta. Es parámetro OBLIGATORIO de cada función de la capa
 * de datos: reemplaza a auth.uid() / auth.jwt() de las políticas RLS.
 *
 * - `anon`: visitante sin sesión (solo lecturas públicas: carta, config).
 * - `cliente`: userId de la sesión; la capa resuelve su client_id.
 * - `repartidor`: userId de la sesión del repartidor.
 * - `admin`: rol tomado de la sesión del servidor (nunca de un campo editable).
 * - `system`: crons, webhooks y Workers autenticados por secreto. Equivale al
 *   service-role de hoy; `reason` queda en el código para auditar quién lo usa.
 */
export type Actor =
  | { kind: "anon" }
  | { kind: "cliente"; userId: string }
  | { kind: "repartidor"; userId: string }
  | { kind: "admin"; userId: string }
  | { kind: "system"; reason: string };

export class ForbiddenError extends Error {
  constructor(message = "No autorizado") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export const anon = (): Actor => ({ kind: "anon" });
export const systemActor = (reason: string): Actor => {
  if (!reason.trim()) throw new Error("systemActor requiere un motivo");
  return { kind: "system", reason };
};

/**
 * Actor a partir de la sesión ya validada por el servidor (requireRole).
 * El rol viene de app_metadata (Supabase) o del campo `role` de Better Auth,
 * nunca de un dato editable por el usuario. Un rol desconocido no da acceso.
 */
export function actorFromSession(session: { userId: string; role: string | null | undefined }): Actor {
  if (!session.userId) return { kind: "anon" };
  switch (session.role) {
    case "admin":
      return { kind: "admin", userId: session.userId };
    case "repartidor":
      return { kind: "repartidor", userId: session.userId };
    case "cliente":
      return { kind: "cliente", userId: session.userId };
    default:
      return { kind: "anon" };
  }
}

export function isStaff(actor: Actor): boolean {
  return actor.kind === "admin" || actor.kind === "system";
}

export function requireStaff(actor: Actor): void {
  if (!isStaff(actor)) throw new ForbiddenError();
}

export function requireAuthenticated(actor: Actor): asserts actor is Exclude<Actor, { kind: "anon" }> {
  if (actor.kind === "anon") throw new ForbiddenError("Sesión requerida");
}
