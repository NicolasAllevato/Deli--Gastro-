import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { mercadoPagoGateway } from "@/lib/payments/gateway";
import { readMpConfig } from "@/lib/payments/mp-api";
import { handleMercadoPagoWebhook } from "@/lib/payments/webhook";
import { notifyOrderEvent } from "@/lib/whatsapp/notify";

// Mercado Pago llama a este endpoint sin sesión: la autenticidad se prueba con la firma HMAC del
// webhook (secreto propio, NO el access token) y con un timestamp fresco. Toda la lógica vive en
// `handleMercadoPagoWebhook`; acá solo se traduce HTTP.

export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 120, 60_000))) return new NextResponse(null, { status: 429 });

  const cfg = readMpConfig();
  if (!cfg) return new NextResponse("Webhook not configured", { status: 503 });

  const db = createAdminClient();
  const result = await handleMercadoPagoWebhook(db, mercadoPagoGateway(cfg), {
    rawBody: await req.text(),
    signatureHeader: req.headers.get("x-signature"),
    requestId: req.headers.get("x-request-id"),
    queryDataId: req.nextUrl.searchParams.get("data.id"),
    queryType: req.nextUrl.searchParams.get("type"),
    secret: cfg.webhookSecret,
  });

  if (result.status !== 200) {
    console.warn("[mp.webhook] rechazado", { status: result.status, reason: result.body?.reason });
    return NextResponse.json(result.body ?? {}, { status: result.status });
  }

  const orderId = result.createdOrderId;
  if (orderId) after(() => notifyOrderEvent(db, orderId, "created"));
  console.log("[mp.webhook]", { result: result.body?.result ?? "ignored" });
  return NextResponse.json(result.body ?? { received: true });
}
