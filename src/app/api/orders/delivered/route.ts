import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { ALL, DELIVERED_CHANNELS, isValidRange, MAX_RANGE_DAYS, type DeliveredChannel } from "@/lib/delivered-map";
import { loadDeliveredMap } from "@/lib/delivered-map-server";

const CHANNELS = [ALL, ...DELIVERED_CHANNELS.map((c) => c.value)] as [typeof ALL, ...DeliveredChannel[]];

const querySchema = z
  .object({
    from: z.iso.datetime(),
    to: z.iso.datetime(),
    channel: z.enum(CHANNELS).default(ALL),
    courier: z.string().trim().min(1).max(60).default(ALL),
  })
  .refine((v) => isValidRange(v.from, v.to), { message: `Rango de fechas inválido (máximo ${MAX_RANGE_DAYS} días).` });

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 120, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = querySchema.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, { status: 400 });
  }
  try {
    return NextResponse.json(await loadDeliveredMap(createAdminClient(), parsed.data));
  } catch {
    return NextResponse.json({ error: "No se pudieron leer los pedidos entregados." }, { status: 500 });
  }
}
