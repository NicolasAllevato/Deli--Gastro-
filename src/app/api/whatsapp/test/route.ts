import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { diagnose } from "@/lib/whatsapp/diagnose";

/** Revisa la vinculación completa (número, cuenta y suscripción) sin enviar ningún mensaje. */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const settings = await loadWhatsAppSettings(createAdminClient());
  const client = clientFor(settings);
  if (!client) {
    return NextResponse.json({ error: "Cargá el Phone Number ID y el token de acceso primero." }, { status: 400 });
  }

  // El modo demo usa el cliente simulado: no sale a internet.
  return NextResponse.json(await diagnose(client, Boolean(settings.wabaId)));
}
