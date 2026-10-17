import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { MAX_CAMPAIGNS_PER_DAY, MAX_RECIPIENTS, campaignsToday, resolveRecipients } from "@/lib/whatsapp/campaigns";
import { segmentSchema } from "@/lib/whatsapp/segment-schema";

const SAMPLE = 5;

const bodySchema = z.object({ segment: segmentSchema }).strict();

/** Cuántos clientes recibirían la campaña, antes de enviarla. */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Segmento inválido." }, { status: 400 });

  const db = createAdminClient();
  const [recipients, today] = await Promise.all([resolveRecipients(db, parsed.data.segment), campaignsToday(db)]);

  return NextResponse.json({
    count: recipients.length,
    sample: recipients.slice(0, SAMPLE).map((r) => r.name),
    maxRecipients: MAX_RECIPIENTS,
    campaignsLeftToday: Math.max(0, MAX_CAMPAIGNS_PER_DAY - today),
  });
}
