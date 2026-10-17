import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import {
  MAX_CAMPAIGNS_PER_DAY,
  MAX_RECIPIENTS,
  campaignsToday,
  resolveRecipients,
  runCampaign,
} from "@/lib/whatsapp/campaigns";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError } from "@/lib/whatsapp/client";
import { segmentSchema } from "@/lib/whatsapp/segment-schema";
import type { Json } from "@/types/database";

const HISTORY_LIMIT = 20;

const createSchema = z
  .object({
    name: z.string().trim().min(1, "Poné un nombre a la campaña").max(80),
    message: z.string().trim().min(1, "Escribí el mensaje de la promoción").max(300),
    segment: segmentSchema,
  })
  .strict();

/** Historial de campañas, la más reciente primero. */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;

  const { data } = await createAdminClient()
    .from("wa_campaigns")
    .select("id, name, message, status, recipients, sent, failed, created_at, finished_at")
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  return NextResponse.json(data ?? []);
}

/**
 * Lanza una campaña de promoción. Reglas: solo a quienes aceptaron promociones, con la
 * plantilla aprobada por Meta, hasta 200 destinatarios y 2 campañas por día.
 */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 10);
  if (denied) return denied;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }
  const { name, message, segment } = parsed.data;

  const db = createAdminClient();
  const wa = clientFor(await loadWhatsAppSettings(db));
  if (!wa) return NextResponse.json({ error: "Conectá WhatsApp primero." }, { status: 400 });

  try {
    const promo = (await wa.listTemplates()).find((t) => t.name === "promocion");
    if (promo?.status !== "APPROVED") {
      return NextResponse.json({ error: "La plantilla de promoción todavía no está aprobada por Meta." }, { status: 409 });
    }
  } catch (error: unknown) {
    const detail = error instanceof WhatsAppApiError ? error.message : "No se pudo consultar a Meta.";
    return NextResponse.json({ error: detail }, { status: 502 });
  }

  if ((await campaignsToday(db)) >= MAX_CAMPAIGNS_PER_DAY) {
    return NextResponse.json({ error: `Ya lanzaste ${MAX_CAMPAIGNS_PER_DAY} campañas hoy. Probá mañana.` }, { status: 429 });
  }

  const recipients = await resolveRecipients(db, segment);
  if (recipients.length === 0) {
    return NextResponse.json({ error: "Nadie cumple ese segmento (o nadie aceptó recibir promociones)." }, { status: 400 });
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { error: `Son ${recipients.length} destinatarios y el máximo por campaña es ${MAX_RECIPIENTS}. Afiná el segmento.` },
      { status: 400 },
    );
  }

  const { data: campaign, error } = await db
    .from("wa_campaigns")
    .insert({ name, message, segment: segment as Json, recipients: recipients.length })
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: "No se pudo crear la campaña." }, { status: 500 });

  after(() => runCampaign(db, campaign.id, recipients, message));
  return NextResponse.json({ id: campaign.id, recipients: recipients.length }, { status: 202 });
}
