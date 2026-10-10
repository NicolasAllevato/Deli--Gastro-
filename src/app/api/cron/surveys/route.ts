import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { sendDueSurveys } from "@/lib/whatsapp/notify";

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  // Sin secreto configurado el endpoint queda cerrado (falla cerrado), nunca abierto.
  if (!secret) return false;
  const received = Buffer.from(req.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

/**
 * Envía las encuestas de satisfacción pendientes. Lo llama un cron (por ejemplo Vercel Cron,
 * que manda `Authorization: Bearer $CRON_SECRET`) cada 10-15 minutos.
 */
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? req.nextUrl.origin;
  return NextResponse.json(await sendDueSurveys(createAdminClient(), appUrl));
}
