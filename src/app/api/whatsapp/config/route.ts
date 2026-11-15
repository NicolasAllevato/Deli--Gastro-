import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { canReceive, canSend, envOverrides, isCoexistenceEnabled, loadWhatsAppSettings, saveWhatsAppSettings } from "@/lib/whatsapp/config";
import { loadConnectedBy } from "@/lib/whatsapp/connected-by-store";
import { maskSecret } from "@/lib/whatsapp/mask";
import { ID_PATTERN } from "@/lib/whatsapp/embedded-signup";

const field = z.string().trim().max(512).optional();

/** Ids de Meta: solo dígitos (vacío = no cambiar). */
const metaId = (label: string) =>
  z.union([z.literal(""), z.string().trim().regex(ID_PATTERN, `${label} no es válido: solo dígitos.`)]).optional();

const putSchema = z
  .object({
    phoneNumberId: metaId("El Phone Number ID"),
    wabaId: metaId("El WABA ID"),
    accessToken: field,
    appSecret: field,
    verifyToken: field,
    appId: field,
    configId: field,
    coexistence: z.enum(["0", "1"]).optional(),
  })
  .strict();

async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin", req);
  return isAuthorizationError(auth) ? auth.error : null;
}

/**
 * Estado de la conexión. Los secretos (token y app secret) nunca salen completos:
 * solo una pista con los últimos caracteres. Los ids y el token de verificación
 * sí se devuelven porque hay que copiarlos en el panel de Meta.
 */
async function currentState() {
  const settings = await loadWhatsAppSettings(createAdminClient());
  return {
    phoneNumberId: settings.phoneNumberId ?? "",
    wabaId: settings.wabaId ?? "",
    verifyToken: settings.verifyToken ?? "",
    appId: settings.appId ?? "",
    configId: settings.configId ?? "",
    coexistence: isCoexistenceEnabled(settings),
    /** true si WHATSAPP_COEXISTENCE está definida en el entorno: el interruptor del panel no puede cambiarla. */
    coexistenceLocked: envOverrides(["coexistence"]).length > 0,
    accessTokenHint: maskSecret(settings.accessToken),
    appSecretHint: maskSecret(settings.appSecret),
    canSend: canSend(settings),
    canReceive: canReceive(settings),
    /** Quién cerró la última conexión con Facebook (null si todavía no hay registro). */
    connectedBy: await loadConnectedBy(createAdminClient()),
  };
}

export async function GET(req: NextRequest) {
  const denied = await guard(req, 60);
  if (denied) return denied;
  return NextResponse.json(await currentState());
}

export async function PUT(req: NextRequest) {
  const denied = await guard(req, 20);
  if (denied) return denied;

  const parsed = putSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }

  try {
    await saveWhatsAppSettings(createAdminClient(), parsed.data);
  } catch (error: unknown) {
    const missingKey = error instanceof Error && /SETTINGS_ENC_KEY/.test(error.message);
    console.error("[whatsapp.config] no se pudo guardar:", missingKey ? "falta o es inválida SETTINGS_ENC_KEY" : "error de base");
    return NextResponse.json(
      {
        error: missingKey
          ? "El servidor no tiene configurada la clave de cifrado (SETTINGS_ENC_KEY). Hasta cargarla no se puede guardar nada."
          : "No se pudo guardar la configuración.",
      },
      { status: 500 },
    );
  }
  return NextResponse.json(await currentState());
}
