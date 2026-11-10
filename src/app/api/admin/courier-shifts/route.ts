import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { decideShift, listShifts } from "@/lib/courier-shifts";

// Habilitación diaria de repartidores: el admin ve las solicitudes del día y las acepta o rechaza.

const patchSchema = z.object({
  id: z.uuid(),
  status: z.enum(["approved", "rejected"]),
});

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  try {
    return NextResponse.json(await listShifts(createAdminClient()));
  } catch (error: unknown) {
    console.error("[admin/courier-shifts] listar", error);
    return NextResponse.json({ error: "No se pudieron leer las habilitaciones." }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;
  const denied = await guardAdmin(req, 30);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  try {
    const shift = await decideShift(createAdminClient(), parsed.data.id, parsed.data.status);
    if (!shift) return NextResponse.json({ error: "La solicitud ya no es de hoy. Actualizá la página." }, { status: 404 });
    return NextResponse.json(shift);
  } catch (error: unknown) {
    console.error("[admin/courier-shifts] decidir", error);
    return NextResponse.json({ error: "No se pudo guardar la habilitación." }, { status: 500 });
  }
}
