import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { canManageUsers, staffAccessOf, type StaffAccess } from "@/lib/auth/permissions";

/**
 * Límite de pedidos por IP + exige rol admin. Devuelve la respuesta de error
 * (429/401/403) o null si la solicitud puede seguir.
 *
 * Además de rol y CSRF, `requireRole` aplica los permisos por sección del personal (gerente, cajero)
 * según la URL y el método del pedido, así que las rutas no repiten esa verificación.
 */
export async function guardAdmin(req: NextRequest, limitPerMinute: number): Promise<NextResponse | null> {
  if (!(await rateLimit(getClientIp(req), limitPerMinute, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin", req);
  return isAuthorizationError(auth) ? auth.error : null;
}

export type OwnerGuardResult = { error: NextResponse } | { user: User; access: StaffAccess };

/**
 * Como `guardAdmin` pero solo para el dueño (staff_role = admin): gestión de usuarios.
 * Devuelve el usuario y su acceso para que la ruta sepa quién edita.
 */
export async function guardOwner(req: NextRequest, limitPerMinute: number): Promise<OwnerGuardResult> {
  if (!(await rateLimit(getClientIp(req), limitPerMinute, 60_000))) {
    return { error: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }) };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { error: auth.error };
  const access = staffAccessOf(auth.user.app_metadata);
  if (!canManageUsers(access)) {
    return { error: NextResponse.json({ error: "Solo el dueño puede gestionar usuarios." }, { status: 403 }) };
  }
  return { user: auth.user, access };
}
