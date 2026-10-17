import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { sendDailySummaryNow } from "@/lib/daily-summary/send";

/** Envía ahora el resumen de hoy a los destinatarios guardados (prueba). No marca el día como enviado. */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 5);
  if (denied) return denied;
  try {
    return NextResponse.json(await sendDailySummaryNow(createAdminClient()));
  } catch (error: unknown) {
    console.error("[admin/daily-summary]", error);
    return NextResponse.json({ error: "No se pudo enviar el resumen de prueba." }, { status: 500 });
  }
}
