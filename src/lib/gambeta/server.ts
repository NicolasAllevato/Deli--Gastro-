/** Piezas compartidas de las rutas /api/admin/sitio: guard (solo dueño + límite de pedidos) y lectura del sitio. */
import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession, type Actor } from "@/lib/data";
import { createGambetaClient, GambetaError, readGambetaApiKey, type GambetaClient } from "./client";
import type { SiteCategory, SitePromotion } from "./schemas";

export type Guard = { denied: NextResponse; actor: null; userId: null } | { denied: null; actor: Actor; userId: string };

export async function guard(req: NextRequest, limit: number): Promise<Guard> {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return { denied: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }), actor: null, userId: null };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { denied: auth.error, actor: null, userId: null };
  return { denied: null, actor: actorFromSession({ userId: auth.user.id, role: auth.role }), userId: auth.user.id };
}

export const gambetaClient = (): GambetaClient => createGambetaClient({ apiKey: readGambetaApiKey() });

/** Mensaje seguro para mostrar (los errores del cliente nunca llevan la clave). */
export function gambetaMessage(err: unknown): string {
  return err instanceof GambetaError ? err.message : "No se pudo leer el sitio web.";
}

export async function loadSite(client: GambetaClient): Promise<{ catalog: SiteCategory[]; promotions: SitePromotion[] }> {
  const [catalog, promotions] = await Promise.all([client.getCatalog(), client.getPromotions()]);
  return { catalog, promotions };
}

export function serverError(op: string, err: unknown): NextResponse {
  console.error(`[admin/sitio] ${op}`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}
