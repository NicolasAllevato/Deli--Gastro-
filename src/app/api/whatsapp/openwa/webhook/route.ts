import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { processWebhookEvents } from "@/lib/whatsapp/inbound";
import { openwaConfigFromEnv, parseOpenWAWebhook } from "@/lib/whatsapp/openwa";
import { verifySignature } from "@/lib/whatsapp/signature";

// OpenWA llama a este endpoint sin sesión: la autenticidad se prueba con la firma HMAC
// (`X-OpenWA-Signature`, mismo formato que la de Meta) del secreto con que se registró el webhook.

const MAX_BODY_BYTES = 1_000_000;

export async function POST(req: NextRequest) {
  const secret = process.env.OPENWA_WEBHOOK_SECRET?.trim();
  const cfg = openwaConfigFromEnv();
  if (!secret || !cfg) return new NextResponse("Webhook not configured", { status: 403 });

  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new NextResponse("Payload too large", { status: 413 });

  if (!verifySignature(raw, req.headers.get("x-openwa-signature"), secret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const events = parseOpenWAWebhook(payload);
  if (events.length > 0) {
    const db = createAdminClient();
    // El filtro por número de `processWebhookEvents` queda atado a la sesión de OpenWA configurada.
    const settings = { ...(await loadWhatsAppSettings(db)), phoneNumberId: cfg.sessionId };
    // Sin handler: por ahora los mensajes de OpenWA solo se guardan y se responden a mano. El agente
    // se conecta cuando sus respuestas salgan por el canal del mensaje (motor Meta en OpenWA).
    after(() => processWebhookEvents(db, events, settings));
  }
  return new NextResponse("OK", { status: 200 });
}
