import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { courierAuth } from "@/lib/courier-auth";
import { changeCourierPin, pinSchema, setCourierActive } from "@/lib/courier-pins";

// Cambiar el PIN (elegido o generado) o activar/desactivar a un repartidor.

const patchSchema = z.union([
  z.object({ action: z.literal("pin"), pin: pinSchema.optional() }),
  z.object({ action: z.literal("active"), active: z.boolean() }),
]);

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return NextResponse.json({ error: "Repartidor inválido." }, { status: 400 });

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  try {
    const db = createAdminClient();
    const body = parsed.data;
    if (body.action === "pin") {
      const result = await changeCourierPin(db, id, body.pin);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
      return NextResponse.json({ courier: result.courier, pin: result.pin });
    }
    const result = await setCourierActive(db, courierAuth(), id, body.active);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ courier: result.courier });
  } catch (error: unknown) {
    console.error("[admin/couriers] actualizar", error);
    return NextResponse.json({ error: "No se pudo actualizar el repartidor." }, { status: 500 });
  }
}
