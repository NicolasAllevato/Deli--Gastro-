import { NextRequest, NextResponse } from "next/server";
import { guardOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, creditAdminApp, dataBackend } from "@/lib/data";
import { readSaldo, saveConfig } from "@/lib/credit-admin/api";

// Saldo a favor: configuración (tope por reclamo, vencimiento), búsqueda de clientes e historial. Solo el dueño, solo D1.
const UNAVAILABLE = "El saldo a favor solo está disponible con la base D1.";
const available = () => dataBackend() === "d1" && !isDemoMode();

export async function GET(req: NextRequest) {
  const guard = await guardOwner(req, 60);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  const r = await readSaldo(actorFromSession({ userId: guard.user.id, role: "admin" }), req.nextUrl.searchParams, creditAdminApp);
  return NextResponse.json(r.body, { status: r.status });
}

export async function PUT(req: NextRequest) {
  const guard = await guardOwner(req, 20);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  const r = await saveConfig(actorFromSession({ userId: guard.user.id, role: "admin" }), await req.json().catch(() => null), creditAdminApp);
  return NextResponse.json(r.body, { status: r.status });
}
