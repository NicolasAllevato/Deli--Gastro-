import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError } from "@/lib/whatsapp/client";

/** Verifica las credenciales pidiendo a Meta los datos del número (no envía ningún mensaje). */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const client = clientFor(await loadWhatsAppSettings(createAdminClient()));
  if (!client) {
    return NextResponse.json({ error: "Cargá el Phone Number ID y el token de acceso primero." }, { status: 400 });
  }

  // El modo demo no sale a internet.
  if (isDemoMode()) {
    return NextResponse.json({ ok: true, displayPhoneNumber: "+54 9 11 0000-0000", verifiedName: "Deli-Gastro (demo)" });
  }

  try {
    const info = await client.getPhoneInfo();
    return NextResponse.json({
      ok: true,
      displayPhoneNumber: info.display_phone_number,
      verifiedName: info.verified_name,
      quality: info.quality_rating ?? null,
    });
  } catch (error: unknown) {
    const message = error instanceof WhatsAppApiError ? error.message : "No se pudo conectar con WhatsApp.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
