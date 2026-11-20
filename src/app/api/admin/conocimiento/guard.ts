import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession } from "@/lib/data";

/**
 * Entrada común de las rutas de /api/admin/conocimiento: tope de pedidos por IP, sesión de admin y verificación de origen (CSRF,
 * dentro de requireRole). Devuelve `denied` (la respuesta de rechazo lista para devolver) o el actor del admin.
 */
export async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return { denied: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }), actor: null };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { denied: auth.error, actor: null };
  return { denied: null, actor: actorFromSession({ userId: auth.user.id, role: auth.role }) };
}
