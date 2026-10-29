import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { canReceive, canSend, loadWhatsAppSettings, saveWhatsAppSettings } from "@/lib/whatsapp/config";
import { maskSecret } from "@/lib/whatsapp/mask";

const field = z.string().trim().max(512).optional();

const putSchema = z
  .object({
    phoneNumberId: field,
    wabaId: field,
    accessToken: field,
    appSecret: field,
    verifyToken: field,
    appId: field,
    configId: field,
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
    accessTokenHint: maskSecret(settings.accessToken),
    appSecretHint: maskSecret(settings.appSecret),
    canSend: canSend(settings),
    canReceive: canReceive(settings),
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
  } catch {
    return NextResponse.json({ error: "No se pudo guardar la configuración." }, { status: 500 });
  }
  return NextResponse.json(await currentState());
}
