import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { revealCourierPin } from "@/lib/courier-pins";

// Muestra el PIN actual de un repartidor. Solo admin, a pedido (botón "Mostrar clave"), sin caché.

const NO_STORE = { "Cache-Control": "no-store" };

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardAdmin(req, 30);
  if (denied) return denied;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) {
    return NextResponse.json({ error: "Repartidor inválido." }, { status: 400, headers: NO_STORE });
  }
  try {
    const result = await revealCourierPin(createAdminClient(), id);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return NextResponse.json({ pin: result.pin }, { headers: NO_STORE });
  } catch (error: unknown) {
    console.error("[admin/couriers] ver PIN", error);
    return NextResponse.json({ error: "No se pudo leer el PIN." }, { status: 500, headers: NO_STORE });
  }
}
