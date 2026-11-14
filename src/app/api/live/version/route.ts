import { NextRequest, NextResponse } from "next/server";
import { actorFromSession, dataBackend, dataFor, parseLiveTopics } from "@/lib/data";
import { requireAuth, isAuthorizationError } from "@/lib/auth/requireRole";
import { rateLimit, getClientIp } from "@/utils/rate-limit";

/**
 * Etapa 4 del corte (DATA_BACKEND=d1): versión de cada topic, consultada cada 5 s por las
 * pantallas en vivo en lugar de Supabase Realtime. No trae datos; si la versión cambió, la
 * pantalla vuelve a pedir sus datos a la API de siempre. Con Supabase responde 404.
 */
export async function GET(req: NextRequest) {
  if (dataBackend() !== "d1") return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const auth = await requireAuth(req);
  if (isAuthorizationError(auth)) return auth.error;
  // Clave IP + usuario: varias tablets del local detrás del mismo NAT no se cortan entre sí.
  // Una pantalla con 2 topics a 5 s son 24/min; 120 deja margen para varias pestañas.
  if (!(await rateLimit(`live:${getClientIp(req)}:${auth.user.id}`, 120, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const topics = parseLiveTopics(req.nextUrl.searchParams.get("topics"));
  if (!topics) return NextResponse.json({ error: "Topics inválidos." }, { status: 400 });

  try {
    const data = await dataFor(actorFromSession({ userId: auth.user.id, role: auth.role }));
    const versions = await data.liveVersions(topics);
    return NextResponse.json({ versions }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    console.error("[live] versión", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}
