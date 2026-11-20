import { NextRequest, NextResponse } from "next/server";
import { guardOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, dataBackend, staffUsersApp } from "@/lib/data";
import { createStaffUserApi, listStaffUsersApi } from "@/lib/staff-users/api";

// Usuarios del personal (admin, gerente, cajero) y lista de repartidores en solo lectura.
// Solo el dueño. Requiere D1: con Supabase o el modo demo todos los admin son dueños y no hay nada que gestionar.

const UNAVAILABLE = "La gestión de usuarios solo está disponible con la base D1.";

const available = () => dataBackend() === "d1" && !isDemoMode();

export async function GET(req: NextRequest) {
  const guard = await guardOwner(req, 60);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await listStaffUsersApi(staffUsersApp, guard.access, actor, guard.user.id);
    return NextResponse.json(r.body, { status: r.status });
  } catch (error: unknown) {
    console.error("[admin/usuarios] listar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo leer la lista de usuarios." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const guard = await guardOwner(req, 10);
  if ("error" in guard) return guard.error;
  if (!available()) return NextResponse.json({ error: UNAVAILABLE }, { status: 501 });
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await createStaffUserApi(staffUsersApp, guard.access, actor, await req.json().catch(() => null));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error: unknown) {
    console.error("[admin/usuarios] alta", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo crear el usuario." }, { status: 500 });
  }
}
