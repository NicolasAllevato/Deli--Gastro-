import { NextRequest, NextResponse } from "next/server";
import { systemActor } from "@/lib/data";
import { readGambetaApiKey } from "@/lib/gambeta/client";
import { runPublishAs } from "@/lib/gambeta/publish-server";
import { isCronAuthorized } from "@/lib/whatsapp/cron-auth";

export const maxDuration = 60;

/**
 * Publica al sitio web los cambios de la app (precios, activo/oculto, fotos). Lo dispara el Worker
 * `workers/encuestas-cron` cada 15 minutos con `Authorization: Bearer $CRON_SECRET`. Sin `CRON_SECRET` rechaza todo;
 * sin clave del sitio responde 200 con `skipped`.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (!readGambetaApiKey()) return NextResponse.json({ skipped: "sin_clave" });
  try {
    const outcome = await runPublishAs(systemActor("cron publicación al sitio"), { trigger: "cron" });
    return NextResponse.json(outcome);
  } catch (error: unknown) {
    console.error("[cron] sitio-publish", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo publicar al sitio." }, { status: 500 });
  }
}
