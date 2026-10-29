import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { loadDeliverySettings } from "@/lib/zones-server";
import { quoteDelivery } from "@/lib/zones";

const bodySchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

/** Cobertura y costo de envío para una dirección (vista previa del checkout). */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Coordenadas inválidas." }, { status: 400 });

  const { zones, quoteOptions } = await loadDeliverySettings(createAdminClient());
  return NextResponse.json(quoteDelivery(parsed.data, zones, quoteOptions));
}
