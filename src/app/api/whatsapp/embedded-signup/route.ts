import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { clientFor, loadWhatsAppSettings, saveWhatsAppSettings } from "@/lib/whatsapp/config";
import { exchangeCodeForToken, WhatsAppApiError } from "@/lib/whatsapp/client";
import { diagnose } from "@/lib/whatsapp/diagnose";
import { signupBodySchema } from "@/lib/whatsapp/embedded-signup";

const ALREADY_REGISTERED = /already|registrad/i;

/**
 * Cierra el alta con Facebook (Embedded Signup): canjea el código por el token del negocio,
 * guarda token + ids, registra el número con el PIN y suscribe la app al webhook.
 * El código y el token nunca se loguean ni se devuelven.
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 5, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = signupBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }
  const { code, phoneNumberId, wabaId, pin } = parsed.data;

  const db = createAdminClient();
  const before = await loadWhatsAppSettings(db);
  if (!before.appId || !before.appSecret) {
    return NextResponse.json({ error: "Cargá el App ID y el App Secret primero." }, { status: 400 });
  }

  try {
    const accessToken = isDemoMode()
      ? "demo-token"
      : await exchangeCodeForToken({ appId: before.appId, appSecret: before.appSecret, code });
    await saveWhatsAppSettings(db, { accessToken, phoneNumberId, wabaId });

    const settings = await loadWhatsAppSettings(db);
    const client = clientFor(settings);
    if (!client) throw new WhatsAppApiError(500, "No se pudo armar el cliente de WhatsApp.");

    try {
      await client.registerPhone(pin);
    } catch (error: unknown) {
      // Registrar dos veces el mismo número no es un error para el dueño.
      if (!(error instanceof Error && ALREADY_REGISTERED.test(error.message))) throw error;
    }
    await client.subscribeApp();

    return NextResponse.json(await diagnose(client, true));
  } catch (error: unknown) {
    const message = error instanceof WhatsAppApiError ? error.message : "No se pudo completar la conexión con Meta.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
