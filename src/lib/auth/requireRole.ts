import type { User } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getUserRole, type UserRole } from "@/lib/auth/roles";

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
export async function requireAuth(): Promise<AuthorizationResult> {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return { error: NextResponse.json({ error: "No autorizado." }, { status: 401 }) };
  }

  return { user, role: getUserRole(user) };
}

/**
 * Verifica que exista una sesión autenticada Y que el rol del usuario
 * coincida con el requerido. Responde 401 si no hay sesión y 403 si el
 * rol no alcanza.
 */
export async function requireRole(role: UserRole): Promise<AuthorizationResult> {
  const result = await requireAuth();
  if (isError(result)) return result;

  if (result.role !== role) {
    return { error: NextResponse.json({ error: "Acceso denegado." }, { status: 403 }) };
  }

  return result;
}

/**
 * Igual que `requireRole` pero acepta varios roles (ej. admin y repartidor
 * comparten el listado de pedidos con distinto alcance).
 */
export async function requireAnyRole(roles: readonly UserRole[]): Promise<AuthorizationResult> {
  const result = await requireAuth();
  if (isError(result)) return result;

  if (!roles.includes(result.role)) {
    return { error: NextResponse.json({ error: "Acceso denegado." }, { status: 403 }) };
  }

  return result;
}

export { isError as isAuthorizationError };
