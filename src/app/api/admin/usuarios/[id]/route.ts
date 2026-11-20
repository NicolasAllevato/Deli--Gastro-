import { NextRequest, NextResponse } from "next/server";
import { guardOwner } from "@/lib/auth/adminGuard";
import { isDemoMode } from "@/lib/demo/mode";
import { actorFromSession, dataBackend, staffUsersApp } from "@/lib/data";
import { updateStaffUserApi } from "@/lib/staff-users/api";

// Edita a un usuario del personal: nombre, rol, permisos, bloqueo y restablecer contraseña. Solo el dueño.
// Los repartidores no se tocan acá (se gestionan en Pedidos > Repartidores).

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardOwner(req, 30);
  if ("error" in guard) return guard.error;
  if (dataBackend() !== "d1" || isDemoMode()) {
    return NextResponse.json({ error: "La gestión de usuarios solo está disponible con la base D1." }, { status: 501 });
  }
  const { id } = await params;
  try {
    const actor = actorFromSession({ userId: guard.user.id, role: "admin" });
    const r = await updateStaffUserApi(staffUsersApp, guard.access, actor, id, await req.json().catch(() => null));
    return NextResponse.json(r.body, { status: r.status });
  } catch (error: unknown) {
    console.error("[admin/usuarios] actualizar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo actualizar el usuario." }, { status: 500 });
  }
}
