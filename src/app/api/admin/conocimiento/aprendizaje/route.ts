import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession, decisionSchema, kbAprendizajeApp } from "@/lib/data";

/** Sugerencias y errores aprendidos (simulador): listar y aprobar / rechazar / desactivar. Solo admin. */
async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return { denied: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }), actor: null };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { denied: auth.error, actor: null };
  return { denied: null, actor: actorFromSession({ userId: auth.user.id, role: auth.role }) };
}

function serverError(op: string, err: unknown) {
  console.error(`[conocimiento/aprendizaje] ${op}`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  try {
    return NextResponse.json(await kbAprendizajeApp.list(actor));
  } catch (err) {
    return serverError("list", err);
  }
}

export async function PATCH(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  try {
    const ok = await kbAprendizajeApp.decide(actor, parsed.data);
    return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: "Esa acción ya no corresponde: el elemento cambió de estado o no existe. Actualizá la lista." }, { status: 409 });
  } catch (err) {
    return serverError("decide", err);
  }
}
