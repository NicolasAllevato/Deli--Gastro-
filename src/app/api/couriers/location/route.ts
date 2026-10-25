import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { courierDisplayName } from "@/lib/auth/courier";
import { clearCourierLocation, listCourierLocations, locationSchema, saveCourierLocation } from "@/lib/courier-location";

// POST: el teléfono del repartidor manda su posición mientras tiene entregas en curso.
// DELETE: deja de compartirla (terminó las entregas o apagó el seguimiento).
// GET: el admin ve dónde está cada repartidor en el mapa.

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 120, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;
  return NextResponse.json(await listCourierLocations(createAdminClient()));
}

export async function POST(req: NextRequest) {
  // Una posición cada 15 s son 4 por minuto; el margen cubre reintentos sin red.
  if (!(await rateLimit(getClientIp(req), 30, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("repartidor");
  if (isAuthorizationError(auth)) return auth.error;

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }
  const parsed = locationSchema.safeParse(raw);
  if (!parsed.success) return NextResponse.json({ error: "Ubicación inválida." }, { status: 400 });

  const error = await saveCourierLocation(createAdminClient(), auth.user.id, courierDisplayName(auth.user), parsed.data);
  if (error) return NextResponse.json({ error }, { status: 500 });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 30, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("repartidor");
  if (isAuthorizationError(auth)) return auth.error;
  await clearCourierLocation(createAdminClient(), auth.user.id);
  return new NextResponse(null, { status: 204 });
}
