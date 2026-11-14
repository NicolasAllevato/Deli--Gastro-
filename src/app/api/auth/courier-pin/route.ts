import { NextRequest, NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { startCourierSession } from "@/lib/courier-auth";
import { findCourierByPin, loginPinSchema } from "@/lib/courier-pins";

// Ingreso del repartidor solo con su PIN de 6 dígitos (o de 4, durante la transición).
// Los límites cortan la prueba de PIN por fuerza bruta: por IP, por dispositivo y global.
const PER_IP = { max: 5, windowMs: 15 * 60_000 };
const PER_DEVICE = { max: 5, windowMs: 15 * 60_000 };
const GLOBAL = { max: 60, windowMs: 15 * 60_000 };

const bodySchema = z.object({ pin: loginPinSchema });
const deviceSchema = z.string().uuid();

export async function POST(req: NextRequest) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  const tooMany = NextResponse.json(
    { error: "Demasiados intentos. Esperá 15 minutos o pedile ayuda al local." },
    { status: 429 },
  );
  if (!(await rateLimit(`courier-pin:${getClientIp(req)}`, PER_IP.max, PER_IP.windowMs))) return tooMany;
  const device = deviceSchema.safeParse(req.headers.get("x-device-id"));
  if (device.success && !(await rateLimit(`courier-pin:dev:${device.data}`, PER_DEVICE.max, PER_DEVICE.windowMs))) return tooMany;
  if (!(await rateLimit("courier-pin:global", GLOBAL.max, GLOBAL.windowMs))) return tooMany;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "El PIN tiene que tener 6 números." }, { status: 400 });

  try {
    const courier = await findCourierByPin(createAdminClient(), parsed.data.pin);
    if (!courier) return NextResponse.json({ error: "PIN incorrecto." }, { status: 401 });

    const error = await startCourierSession(courier.userId);
    if (error) return NextResponse.json({ error }, { status: 500 });
    return NextResponse.json({ ok: true, home: "/repartidor" });
  } catch (error: unknown) {
    console.error("[auth/courier-pin]", error);
    return NextResponse.json({ error: "No pudimos verificar el PIN. Probá de nuevo." }, { status: 500 });
  }
}
