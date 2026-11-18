import { NextResponse, type NextRequest } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession, reclamosApp, type Actor } from "@/lib/data";
import type { ApiResult, ReclamosApiDeps } from "./api.ts";
import { enviarAlCliente, sugerirReclamo } from "./server.ts";
import { slaCorte } from "./sla.ts";

/** Dependencias reales de las rutas de reclamos. */
export const reclamosDeps: ReclamosApiDeps = {
  list: (actor, filtros) => reclamosApp.list(actor, filtros),
  get: (actor, id) => reclamosApp.get(actor, id),
  porCategoria: (actor, desde) => reclamosApp.porCategoria(actor, desde),
  resumen: async (actor) => reclamosApp.resumen(actor, slaCorte(await reclamosApp.config(actor))),
  cambiarEstado: (actor, id, accion) => reclamosApp.cambiarEstado(actor, id, accion),
  nota: (actor, id, texto) => reclamosApp.nota(actor, id, texto),
  resolver: (actor, id, input) => reclamosApp.resolver(actor, id, input),
  enviar: enviarAlCliente,
  marcarNotificacion: (actor, id, ok, error) => reclamosApp.marcarNotificacion(actor, id, ok, error),
  sugerir: sugerirReclamo,
  entrenamiento: async (actor) => (await reclamosApp.config(actor)).entrenamiento,
};

/** Rate limit por IP + sesión de admin. Devuelve el actor o la respuesta de error. */
export async function adminActor(req: NextRequest, limit: number): Promise<Actor | NextResponse> {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;
  return actorFromSession({ userId: auth.user.id, role: auth.role });
}

export const toResponse = (r: ApiResult) => NextResponse.json(r.body, { status: r.status });
