import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isCronAuthorized } from "@/lib/whatsapp/cron-auth";
import { runDailySummaryIfDue } from "@/lib/daily-summary/send";
import { creditAdminApp, dataBackend, dataFor, systemActor } from "@/lib/data";

export const maxDuration = 60;

/**
 * Envía el resumen del día por mail y WhatsApp cuando pasó la hora de cierre configurada.
 * Lo dispara el Worker `workers/encuestas-cron` cada 15 minutos con `Authorization: Bearer $CRON_SECRET`;
 * la app decide si corresponde y evita el envío doble. Sin `CRON_SECRET` rechaza todo.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  if (dataBackend() === "d1") {
    // Etapa 4: limpieza de versiones viejas de pantallas en vivo. Un fallo no frena el resumen.
    await dataFor(systemActor("cron-live-purge"))
      .then((d) => d.purgeLiveVersions())
      .catch((e: unknown) => console.error("[cron] purga live_versions", e instanceof Error ? e.message : e));
  }
  if (dataBackend() === "d1") {
    // Vencimiento del saldo a favor (idempotente: `vence:<acreditación>`). Un fallo no frena el resumen.
    await creditAdminApp
      .expireAll(systemActor("cron-saldo-vencido"))
      .catch((e: unknown) => console.error("[cron] vencimiento de saldo", e instanceof Error ? e.message : e));
  }
  try {
    return NextResponse.json(await runDailySummaryIfDue(createAdminClient()));
  } catch (error: unknown) {
    console.error("[cron] resumen diario", error);
    return NextResponse.json({ error: "No se pudo enviar el resumen diario." }, { status: 500 });
  }
}
