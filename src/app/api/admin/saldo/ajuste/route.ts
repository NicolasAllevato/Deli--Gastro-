import { NextRequest, NextResponse } from "next/server";
import { guardOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, creditAdminApp, dataBackend } from "@/lib/data";
import { adjustSaldo } from "@/lib/credit-admin/api";

// Carga manual de saldo (sumar o restar con motivo). Solo el dueño, solo D1.
export async function POST(req: NextRequest) {
  const guard = await guardOwner(req, 20);
  if ("error" in guard) return guard.error;
  if (dataBackend() !== "d1" || isDemoMode()) return NextResponse.json({ error: "El saldo a favor solo está disponible con la base D1." }, { status: 501 });
  const meta = guard.user.user_metadata as Record<string, unknown> | undefined;
  const name = typeof meta?.name === "string" ? meta.name : typeof meta?.full_name === "string" ? meta.full_name : "";
  const label = [name, guard.user.email].filter(Boolean).join(" ") || guard.user.id;
  const r = await adjustSaldo(actorFromSession({ userId: guard.user.id, role: "admin" }), label, await req.json().catch(() => null), creditAdminApp);
  return NextResponse.json(r.body, { status: r.status });
}
