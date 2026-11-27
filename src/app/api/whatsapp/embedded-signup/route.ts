import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import {
  clientFor,
  envOverrides,
  isCoexistenceEnabled,
  loadWhatsAppSettings,
  saveWhatsAppSettings,
  type WhatsAppSettings,
} from "@/lib/whatsapp/config";
import { parseConnectedBy } from "@/lib/whatsapp/connected-by";
import { saveConnectedBy } from "@/lib/whatsapp/connected-by-store";
import { diagnose } from "@/lib/whatsapp/diagnose";
import { completeSignup, isDemoSafe, parseSignupRequest, signupErrorResponse } from "@/lib/whatsapp/signup-flow";

const CONNECTED_BY_TIMEOUT_MS = 2000;

/** Corta la espera de algo secundario: si no responde a tiempo, falla y el alta sigue. */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`tiempo agotado (${ms} ms)`)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function hasWorkingConfig(s: WhatsAppSettings): boolean {
  return Boolean(s.accessToken && s.phoneNumberId && s.wabaId);
}

/** Avisa si una variable de entorno tapa lo que el alta acaba de guardar en la base. */
function overrideWarnings(): string[] {
  const names = envOverrides(["accessToken", "phoneNumberId", "wabaId"]);
  if (names.length === 0) return [];
  return [
    `Atención: ${names.join(", ")} está definida en el entorno y tapa lo guardado; ` +
      "el bot y el panel seguirán usando el valor del entorno hasta que la quites.",
  ];
}

/**
 * Cierra el alta con Facebook (Embedded Signup). El modo lo decide el evento que mandó Meta:
 * `coexistence` (sin PIN ni registro) solo si el interruptor guardado está activo; `standard` siempre.
 * Se persiste únicamente si todo salió bien. El código y el token nunca se loguean ni se devuelven.
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 5, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const db = createAdminClient();
  const before = await loadWhatsAppSettings(db);

  const request = parseSignupRequest(await req.json().catch(() => null), isCoexistenceEnabled(before));
  if (!request.ok) return NextResponse.json({ error: request.error }, { status: 400 });

  if (!before.appId || !before.appSecret) {
    return NextResponse.json({ error: "Cargá el App ID y el App Secret primero." }, { status: 400 });
  }

  const demo = isDemoSafe({
    demoMode: isDemoMode(),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
  });

  try {
    const { client } = await completeSignup(request.body, {
      appId: before.appId,
      appSecret: before.appSecret,
      demo,
      hasWorkingConfig: hasWorkingConfig(before),
      save: (patch) => saveWhatsAppSettings(db, patch),
      buildClient: demo
        ? (creds) => {
            const simulated = clientFor({ ...before, ...creds });
            if (!simulated) throw new Error("No se pudo armar el cliente simulado.");
            return simulated;
          }
        : undefined,
    });
    let warnings: string[] = [];
    try {
      warnings = overrideWarnings();
    } catch {
      // Solo es un aviso: si no se puede calcular, la conexión ya guardada sigue valiendo.
    }
    // Registrar quién conectó es secundario: si falla o tarda, la conexión (ya guardada) no se deshace; solo se avisa.
    // El perfil de Facebook lo declara el navegador: se sanea acá y, si no vale, se descarta sin tumbar nada.
    try {
      await withTimeout(
        saveConnectedBy(db, { admin: { id: auth.user.id, email: auth.user.email }, facebook: parseConnectedBy(request.body.facebook) }),
        CONNECTED_BY_TIMEOUT_MS,
      );
    } catch (error: unknown) {
      console.error("[whatsapp.embedded-signup] no se registró quién conectó:", error instanceof Error ? error.message : "error desconocido");
      warnings.push("La conexión quedó lista, pero no se pudo registrar quién la hizo.");
    }
    // Lo que falle después de guardar no deshace la conexión: se responde conectado con un aviso.
    try {
      return NextResponse.json({ ...(await diagnose(client, true)), warnings });
    } catch (error: unknown) {
      console.error("[whatsapp.embedded-signup] falló la verificación posterior:", error instanceof Error ? error.message : "error desconocido");
      warnings.push("La conexión quedó guardada, pero no se pudo verificar ahora. Tocá «Volver a revisar».");
      return NextResponse.json({ ready: false, warnings });
    }
  } catch (error: unknown) {
    console.error("[whatsapp.embedded-signup] alta fallida:", error instanceof Error ? `${error.name}: ${error.message}` : "error desconocido");
    const { status, body } = signupErrorResponse(error);
    return NextResponse.json(body, { status });
  }
}
