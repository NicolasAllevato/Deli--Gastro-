import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession, cartaApp, cartaInputSchema, CartaError } from "@/lib/data";

/** Carta estructurada (secciones y líneas vinculadas a productos): leer y guardar entera. Solo admin. */
async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return { denied: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }), actor: null };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { denied: auth.error, actor: null };
  return { denied: null, actor: actorFromSession({ userId: auth.user.id, role: auth.role }) };
}

function serverError(op: string, err: unknown) {
  console.error(`[admin/carta] ${op}`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  try {
    return NextResponse.json(await cartaApp.admin(actor));
  } catch (err) {
    return serverError("leer", err);
  }
}

export async function PUT(req: NextRequest) {
  const { denied, actor } = await guard(req, 20);
  if (denied || !actor) return denied;
  const parsed = cartaInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  try {
    return NextResponse.json(await cartaApp.save(actor, parsed.data));
  } catch (err) {
    if (err instanceof CartaError) return NextResponse.json({ error: err.message }, { status: 400 });
    return serverError("guardar", err);
  }
}
