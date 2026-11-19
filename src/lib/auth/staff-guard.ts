/**
 * Decisión de los permisos por sección para un pedido a la API, sin dependencias de Next (se prueba sola).
 * `requireRole` / `requireAnyRole` la llaman después de autenticar a un usuario con rol de panel y la
 * convierten en 403. Devuelven el mensaje de rechazo, o null si puede seguir.
 */
import { canManageUsers, canWriteConfigKeys, evaluateAccess, firstAllowedHome, staffAccessOf } from "@/lib/auth/permissions";

type AppMetadata = Readonly<Record<string, unknown>> | null | undefined;

export const READ_ONLY_MESSAGE = "Tu usuario solo puede ver esta sección.";
export const FORBIDDEN_MESSAGE = "No tenés permiso para esta sección.";
export const CONFIG_FORBIDDEN_MESSAGE = "No tenés permiso para cambiar esos ajustes.";

/**
 * El dueño y los usuarios sin `staff_role` (modo Supabase y demo) pasan siempre. Para gerente y cajero se mira la
 * URL y el método del pedido (GET/HEAD piden "ver", el resto "editar"). Sin pedido no se sabe qué se quiere: solo el dueño.
 */
export function staffAccessDenial(meta: AppMetadata, req?: { url: string; method: string }): string | null {
  const access = staffAccessOf(meta);
  if (canManageUsers(access)) return null;
  if (!req) return FORBIDDEN_MESSAGE;
  let pathname: string;
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return FORBIDDEN_MESSAGE;
  }
  const decision = evaluateAccess(access, pathname, req.method);
  if (decision.allowed) return null;
  return decision.reason === "read-only" ? READ_ONLY_MESSAGE : FORBIDDEN_MESSAGE;
}

/** PATCH /api/config: cada clave pertenece a una o más secciones; hace falta poder editar alguna de cada una. */
export function configKeysDenial(meta: AppMetadata, keys: readonly string[]): string | null {
  return canWriteConfigKeys(staffAccessOf(meta), keys) ? null : CONFIG_FORBIDDEN_MESSAGE;
}

export type AdminPageDecision = { kind: "allow" } | { kind: "redirect"; to: string } | { kind: "login" };

/**
 * Qué hace el proxy con una página del panel (`/admin/...`): dejarla pasar, mandar a la primera sección
 * permitida, o, si el usuario no tiene ninguna, a /login. El dueño y los modos sin `staff_role` pasan siempre.
 */
export function adminPageDecision(meta: AppMetadata, pathname: string): AdminPageDecision {
  const access = staffAccessOf(meta);
  if (evaluateAccess(access, pathname, "GET").allowed) return { kind: "allow" };
  const home = firstAllowedHome(access);
  return home ? { kind: "redirect", to: home } : { kind: "login" };
}
