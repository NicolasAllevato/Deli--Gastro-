import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { processWebhookEvents } from "@/lib/whatsapp/inbound";
import { parseWebhook } from "@/lib/whatsapp/payload";
import { inboundHandler } from "@/lib/whatsapp/pipeline";
import { verifySignature } from "@/lib/whatsapp/signature";

// Meta llama a este endpoint sin sesión: la autenticidad se prueba con la firma
// HMAC (POST) y el token de verificación (GET), no con roles.

const MAX_BODY_BYTES = 1_000_000;

function sameText(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Verificación inicial del webhook: Meta manda un desafío que hay que devolver tal cual. */
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const settings = await loadWhatsAppSettings(createAdminClient());

  const valid =
    params.get("hub.mode") === "subscribe" &&
    settings.verifyToken !== null &&
    sameText(params.get("hub.verify_token") ?? "", settings.verifyToken);

  if (!valid) return new NextResponse("Forbidden", { status: 403 });
  return new NextResponse(params.get("hub.challenge") ?? "", { status: 200 });
}

/** Mensajes entrantes y estados de entrega. Se responde 200 enseguida y se procesa después. */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return new NextResponse("Payload too large", { status: 413 });

  const db = createAdminClient();
  const settings = await loadWhatsAppSettings(db);

  // Sin App Secret no hay forma de autenticar a Meta: se rechaza antes de mirar la firma.
  if (!settings.appSecret) return new NextResponse("Webhook not configured", { status: 403 });

  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"), settings.appSecret)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse("Bad request", { status: 400 });
  }

  const events = parseWebhook(payload);
  if (events.length > 0) {
    after(() => processWebhookEvents(db, events, settings, inboundHandler));
  }
  return new NextResponse("OK", { status: 200 });
}
