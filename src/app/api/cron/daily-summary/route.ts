import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isCronAuthorized } from "@/lib/whatsapp/cron-auth";
import { runDailySummaryIfDue } from "@/lib/daily-summary/send";

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
  try {
    return NextResponse.json(await runDailySummaryIfDue(createAdminClient()));
  } catch (error: unknown) {
    console.error("[cron] resumen diario", error);
    return NextResponse.json({ error: "No se pudo enviar el resumen diario." }, { status: 500 });
  }
}
