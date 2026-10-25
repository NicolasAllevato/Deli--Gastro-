import { NextRequest, NextResponse, after } from "next/server";
import { sendAcceptanceToPanel } from "@/lib/legal/panel";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { requireAuth, isAuthorizationError } from "@/lib/auth/requireRole";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { isDemoMode } from "@/lib/demo/mode";
import {
  DEMO_LEGAL_COOKIE,
  LEGAL_BUNDLE_VERSION,
  LEGAL_DOCUMENTS,
  legalStatus,
  type LegalStatus,
} from "@/lib/legal/documents";

const acceptSchema = z.object({ document: z.enum(["terminos", "privacidad"]) });

type Db = ReturnType<typeof createAdminClient>;

async function statusFor(db: Db, userId: string): Promise<LegalStatus> {
  const { data, error } = await db
    .from("legal_acceptances")
    .select("document, version, accepted_at")
    .eq("user_id", userId);
  if (error) throw new Error(`No se pudieron leer las aceptaciones: ${error.message}`);
  return legalStatus(data ?? []);
}

/**
 * Deja la marca que lee el proxy para dejar pasar a los portales. En Supabase va en
 * `app_metadata` (solo la escribe el servidor); en demo, en una cookie httpOnly.
 */
async function markComplete(res: NextResponse, db: Db, userId: string, appMetadata: Record<string, unknown>) {
  if (isDemoMode()) {
    res.cookies.set(DEMO_LEGAL_COOKIE, LEGAL_BUNDLE_VERSION, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return;
  }
  const { error } = await db.auth.admin.updateUserById(userId, {
    app_metadata: { ...appMetadata, legal_version: LEGAL_BUNDLE_VERSION },
  });
  if (error) throw new Error(`No se pudo registrar la aceptación en la sesión: ${error.message}`);
}

/** ¿Ya tiene la marca que lee el proxy? Sin ella, "Ingresar" vuelve a mandar a esta pantalla. */
function hasMark(req: NextRequest, appMetadata: Record<string, unknown> | undefined): boolean {
  if (isDemoMode()) return req.cookies.get(DEMO_LEGAL_COOKIE)?.value === LEGAL_BUNDLE_VERSION;
  return appMetadata?.legal_version === LEGAL_BUNDLE_VERSION;
}

/**
 * Estado de aceptación del usuario actual. Si ya aceptó todo pero falta la marca (se aceptó en otro
 * navegador, se perdió la cookie o falló al escribirla), se deja ahora para que pueda entrar.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (isAuthorizationError(auth)) return auth.error;
  try {
    const db = createAdminClient();
    const status = await statusFor(db, auth.user.id);
    const res = NextResponse.json(status);
    if (status.complete && !hasMark(req, auth.user.app_metadata)) {
      await markComplete(res, db, auth.user.id, auth.user.app_metadata ?? {});
    }
    return res;
  } catch (error: unknown) {
    console.error("[legal] estado", error);
    return NextResponse.json({ error: "No pudimos verificar tus aceptaciones." }, { status: 500 });
  }
}

/** Acepta un documento (uno por llamada: cada uno tiene su propio botón). */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!(await rateLimit(ip, 20, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireAuth();
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = acceptSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Documento inválido." }, { status: 400 });

  const doc = LEGAL_DOCUMENTS.find((d) => d.id === parsed.data.document)!;
  const db = createAdminClient();
  try {
    const { error } = await db.from("legal_acceptances").upsert(
      {
        user_id: auth.user.id,
        email: auth.user.email ?? null,
        role: auth.role,
        document: doc.id,
        version: doc.version,
        ip,
        user_agent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
      },
      { onConflict: "user_id,document,version", ignoreDuplicates: true },
    );
    if (error) throw new Error(error.message);

    // Copia en el Panel de control de OPSYN, después de responder: no demora ni frena al usuario.
    after(() => sendAcceptanceToPanel({
      userId: auth.user.id,
      email: auth.user.email ?? null,
      role: auth.role,
      document: doc.id,
      version: doc.version,
      acceptedAt: new Date().toISOString(),
      ip,
      userAgent: req.headers.get("user-agent")?.slice(0, 300) ?? null,
    }));

    const status = await statusFor(db, auth.user.id);
    const res = NextResponse.json(status);
    if (status.complete) await markComplete(res, db, auth.user.id, auth.user.app_metadata ?? {});
    return res;
  } catch (error: unknown) {
    console.error("[legal] aceptar", doc.id, error);
    return NextResponse.json({ error: "No pudimos guardar tu aceptación. Probá de nuevo." }, { status: 500 });
  }
}
