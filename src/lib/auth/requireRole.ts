import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getUserRole, type UserRole } from "@/lib/auth/roles";
import { isSameOriginRequest } from "@/lib/auth/origin-guard";
import { configKeysDenial, staffAccessDenial } from "@/lib/auth/staff-guard";

export interface AuthorizedRequest {
  user: User;
  role: UserRole;
}

export type AuthorizationResult = AuthorizedRequest | { error: NextResponse };

function isError(result: AuthorizationResult): result is { error: NextResponse } {
  return "error" in result;
}

/**
 * Verifica que exista una sesión autenticada. No exige un rol específico.
 * Usar cuando el endpoint es compartido entre roles pero necesita el
 * usuario/rol para filtrar datos (ej. "cliente ve sus propios pedidos").
 */
export async function requireAuth(req?: Request): Promise<AuthorizationResult> {
  // CSRF: las mutaciones con cookie de sesion solo se aceptan desde el mismo origen. Punto unico de
  // entrada: requireRole, requireAnyRole, requireClient y guardAdmin pasan por aca.
  if (req && !isSameOriginRequest(req.headers, req.method)) {
    return { error: NextResponse.json({ error: "Origen no permitido" }, { status: 403 }) };
  }
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  return { user, role: getUserRole(user) };
}

/**
 * Permisos por sección del personal (gerente, cajero): punto único para requireRole y requireAnyRole.
 * La decisión vive en staff-guard.ts; acá solo se convierte en 403.
 */
function denyOutsideStaffPermissions(user: Pick<User, "app_metadata">, req?: Request): NextResponse | null {
  const message = staffAccessDenial(user.app_metadata, req);
  return message ? NextResponse.json({ error: message }, { status: 403 }) : null;
}

/**
 * Para PATCH /api/config: devuelve 403 si el usuario no puede editar alguna de las claves que manda
 * (Zonas guarda el radio y el local, el Agente IA sus ajustes, el resto es de Configuración), o null si puede seguir.
 */
export function denyConfigKeys(user: Pick<User, "app_metadata">, keys: readonly string[]): NextResponse | null {
  const message = configKeysDenial(user.app_metadata, keys);
  return message ? NextResponse.json({ error: message }, { status: 403 }) : null;
}

/**
 * Verifica que exista una sesión autenticada Y que el rol del usuario
 * coincida con el requerido. Responde 401 si no hay sesión y 403 si el
 * rol no alcanza (o, siendo admin del panel, si sus permisos por sección no alcanzan).
 */
export async function requireRole(role: UserRole, req?: Request): Promise<AuthorizationResult> {
  const result = await requireAuth(req);
  if (isError(result)) return result;

  if (result.role !== role) {
    return { error: NextResponse.json({ error: "Acceso denegado." }, { status: 403 }) };
  }

  if (role === "admin") {
    const denied = denyOutsideStaffPermissions(result.user, req);
    if (denied) return { error: denied };
  }

  return result;
}

/**
 * Igual que `requireRole` pero acepta varios roles (ej. admin y repartidor
 * comparten el listado de pedidos con distinto alcance).
 */
export async function requireAnyRole(roles: readonly UserRole[], req?: Request): Promise<AuthorizationResult> {
  const result = await requireAuth(req);
  if (isError(result)) return result;

  if (!roles.includes(result.role)) {
    return { error: NextResponse.json({ error: "Acceso denegado." }, { status: 403 }) };
  }

  if (result.role === "admin") {
    const denied = denyOutsideStaffPermissions(result.user, req);
    if (denied) return { error: denied };
  }

  return result;
}

/**
 * Para rutas con cookie de sesión que no usan los guards de arriba (reviews, chat):
 * 403 si la mutación viene de otro origen, o null si puede seguir.
 */
export function rejectCrossOrigin(req: Request): NextResponse | null {
  return isSameOriginRequest(req.headers, req.method)
    ? null
    : NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
}

export { isError as isAuthorizationError };
