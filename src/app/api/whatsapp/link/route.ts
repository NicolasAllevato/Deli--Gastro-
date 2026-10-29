import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError } from "@/lib/whatsapp/client";

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("subscribe") }).strict(),
  z.object({ action: z.literal("register"), pin: z.string().regex(/^\d{6}$/, "El PIN tiene que ser de 6 dígitos.") }).strict(),
]);

/** Pasos de vinculación con Meta: suscribir la app a la cuenta y registrar el número. */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 5, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }

  const settings = await loadWhatsAppSettings(createAdminClient());
  const client = clientFor(settings);
  if (!client) {
    return NextResponse.json({ error: "Cargá el Phone Number ID y el token de acceso primero." }, { status: 400 });
  }
  if (parsed.data.action === "subscribe" && !settings.wabaId) {
    return NextResponse.json({ error: "Cargá el WABA ID primero." }, { status: 400 });
  }

  try {
    if (parsed.data.action === "subscribe") {
      await client.subscribeApp();
      return NextResponse.json({ ok: true, message: "App suscrita: los mensajes van a llegar al webhook." });
    }
    await client.registerPhone(parsed.data.pin);
    return NextResponse.json({ ok: true, message: "Número registrado en la Cloud API." });
  } catch (error: unknown) {
    const message = error instanceof WhatsAppApiError ? error.message : "No se pudo completar el paso con Meta.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
