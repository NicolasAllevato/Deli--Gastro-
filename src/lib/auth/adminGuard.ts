import type { User } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { canManageUsers, staffAccessOf, type StaffAccess } from "@/lib/auth/permissions";
import { isSuperOwnerEmail, superOwnerEmailFrom } from "@/lib/auth/owner-rules";

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

export type SuperOwnerGuardResult = { error: NextResponse } | { user: User; access: StaffAccess };

/**
 * Solo el dueño principal (el email de SUPER_OWNER_EMAIL): eliminación de datos personales. Un dueño común, un gerente
 * o un cajero reciben 403. Sin SUPER_OWNER_EMAIL configurada nadie pasa (modo seguro). La capa de datos lo vuelve a
 * verificar contra la base: acá se corta temprano, antes de leer el cuerpo.
 */
export async function guardSuperOwner(req: NextRequest, limitPerMinute: number): Promise<SuperOwnerGuardResult> {
  const guard = await guardOwner(req, limitPerMinute);
  if ("error" in guard) return guard;
  if (!isSuperOwnerEmail(guard.user.email, superOwnerEmailFrom(process.env))) {
    return { error: NextResponse.json({ error: "Solo el dueño principal puede eliminar datos personales." }, { status: 403 }) };
  }
  return guard;
}
