import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession, reclamoEstadoSchema, reclamosApp } from "@/lib/data";

/** Tickets de reclamo que dejó el bot fuera de horario: listar y marcar abierto/resuelto. Solo admin. */
async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return { denied: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }), actor: null };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { denied: auth.error, actor: null };
  return { denied: null, actor: actorFromSession({ userId: auth.user.id, role: auth.role }) };
}

function serverError(op: string, err: unknown) {
  console.error(`[conocimiento/reclamos] ${op}`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  try {
    return NextResponse.json({ reclamos: await reclamosApp.list(actor) });
  } catch (err) {
    return serverError("list", err);
  }
}

export async function PATCH(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  const parsed = reclamoEstadoSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try {
    const ok = await reclamosApp.setEstado(actor, parsed.data);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "No se encontró el reclamo." }, { status: 404 });
  } catch (err) {
    return serverError("estado", err);
  }
}
