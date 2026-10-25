import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { fudoGatewayConfig, GATEWAY_SIGNATURE_HEADER, verifyGatewaySignature } from "@/lib/fudo/gateway";
import { applyFudoStatus, FUDO_EVENTS } from "@/lib/fudo/status";

// Lo llama solo el Worker `fudo-gateway`, después de validar la firma `fudo-signature` del webhook
// de Fudo. Acá se prueba que viene del Worker (HMAC con FUDO_GATEWAY_SECRET) y se aplica el estado
// con los mismos efectos que el tablero: aviso por WhatsApp, puntos, devoluciones.

const bodySchema = z
  .object({
    event: z.enum(FUDO_EVENTS),
    orderId: z.string().uuid().optional(),
    fudoOrderId: z.number().int().positive().optional(),
  })
  .refine((v) => v.orderId !== undefined || v.fudoOrderId !== undefined, { message: "Falta orderId o fudoOrderId" });

export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 300, 60_000))) return new NextResponse(null, { status: 429 });

  const cfg = fudoGatewayConfig();
  if (!cfg) return new NextResponse("Fudo not configured", { status: 503 });

  const rawBody = await req.text();
  if (!verifyGatewaySignature(rawBody, req.headers.get(GATEWAY_SIGNATURE_HEADER), cfg.secret)) {
    return NextResponse.json({ error: "Firma inválida." }, { status: 401 });
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });

  const result = await applyFudoStatus(createAdminClient(), parsed.data);
  // 200 aunque se ignore: un webhook repetido o desordenado no es un error para reintentar.
  if (!result.applied && result.reason === "not_found") return NextResponse.json(result, { status: 404 });
  return NextResponse.json(result);
}
