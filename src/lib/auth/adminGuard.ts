import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";

/**
 * Límite de pedidos por IP + exige rol admin. Devuelve la respuesta de error
 * (429/401/403) o null si la solicitud puede seguir.
 */
export async function guardAdmin(req: NextRequest, limitPerMinute: number): Promise<NextResponse | null> {
  if (!(await rateLimit(getClientIp(req), limitPerMinute, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin", req);
  return isAuthorizationError(auth) ? auth.error : null;
}
