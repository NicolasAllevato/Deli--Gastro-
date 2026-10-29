import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { geocodeAddress } from "@/lib/geocode";
import { readConfig } from "@/lib/orders-server";
import { SAMPLE_ADDRESSES } from "@/lib/restaurant";
import { localFromConfig } from "@/lib/zones-server";

const querySchema = z.string().trim().min(5, "Escribí la calle y la altura").max(200);

/** Busca una dirección y devuelve hasta 5 coordenadas candidatas. */
export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 20, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  const query = querySchema.safeParse(req.nextUrl.searchParams.get("q") ?? "");
  if (!query.success) {
    return NextResponse.json({ error: query.error.issues[0]?.message ?? "Dirección inválida." }, { status: 400 });
  }

  // El modo demo no sale a internet: busca entre las direcciones de ejemplo.
  if (isDemoMode()) {
    const needle = query.data.toLowerCase();
    const matches = SAMPLE_ADDRESSES.filter((a) =>
      `${a.label} ${a.address}`.toLowerCase().includes(needle),
    ).map((a) => ({ label: a.address, lat: a.lat, lng: a.lng }));
    return NextResponse.json(matches);
  }

  try {
    const local = localFromConfig(await readConfig(createAdminClient()));
    return NextResponse.json(await geocodeAddress(query.data, local));
  } catch {
    return NextResponse.json({ error: "No pudimos buscar la dirección. Probá de nuevo en un momento." }, { status: 502 });
  }
}
