import { NextRequest, NextResponse } from "next/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { listCourierNames } from "@/lib/couriers";

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  try {
    return NextResponse.json(await listCourierNames());
  } catch {
    return NextResponse.json({ error: "No se pudo obtener la lista de repartidores." }, { status: 500 });
  }
}
