import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { clientFor, loadWhatsAppSettings, saveWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError } from "@/lib/whatsapp/client";
import { diagnose } from "@/lib/whatsapp/diagnose";
import { signupBodySchema } from "@/lib/whatsapp/embedded-signup";
import { completeSignup } from "@/lib/whatsapp/signup-flow";

/**
 * Cierra el alta con Facebook (Embedded Signup): canjea el código por el token del negocio,
 * guarda token + ids y suscribe la app a la WABA. En modo estándar registra el número con el PIN;
 * en coexistencia no (el número ya está registrado). El código y el token nunca se loguean ni se devuelven.
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 5, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = signupBodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }

  const db = createAdminClient();
  const before = await loadWhatsAppSettings(db);
  if (!before.appId || !before.appSecret) {
    return NextResponse.json({ error: "Cargá el App ID y el App Secret primero." }, { status: 400 });
  }

  try {
    const { client } = await completeSignup(parsed.data, {
      appId: before.appId,
      appSecret: before.appSecret,
      demo: isDemoMode(),
      save: (patch) => saveWhatsAppSettings(db, patch),
      // En demo se usa el cliente simulado; si no, el real que arma completeSignup.
      buildClient: isDemoMode()
        ? async () => {
            const demo = clientFor(await loadWhatsAppSettings(db));
            if (!demo) throw new WhatsAppApiError(500, "No se pudo armar el cliente de WhatsApp.");
            return demo;
          }
        : undefined,
    });
    return NextResponse.json(await diagnose(client, true));
  } catch (error: unknown) {
    const message = error instanceof WhatsAppApiError ? error.message : "No se pudo completar la conexión con Meta.";
    const status = error instanceof WhatsAppApiError && error.status === 409 ? 409 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
