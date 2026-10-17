import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isCronAuthorized } from "@/lib/whatsapp/cron-auth";
import { sendDueSurveys } from "@/lib/whatsapp/notify";

export const maxDuration = 60;

/**
 * Envía las encuestas de satisfacción pendientes. Lo dispara el Worker de Cloudflare
 * `workers/encuestas-cron` cada 15 minutos con `Authorization: Bearer $CRON_SECRET`.
 * Sin `CRON_SECRET` configurado rechaza todo.
 */
export async function GET(req: NextRequest) {
  if (!isCronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  try {
    return NextResponse.json(await sendDueSurveys(createAdminClient(), appUrl));
  } catch (error: unknown) {
    console.error("[cron] encuestas", error);
    return NextResponse.json({ error: "No se pudieron procesar las encuestas." }, { status: 500 });
  }
}
