import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import type { Json } from "@/types/database";
import { promoListSchema } from "@/lib/promos";
import { COURIER_ASSIGN_MODES, COURIER_ASSIGN_MODE_KEY } from "@/lib/courier-assign";
import { DAILY_SUMMARY_KEY, dailySummarySettingsSchema } from "@/lib/daily-summary/settings";

// Sólo estas keys pueden escribirse — evita que un PATCH inyecte filas
// arbitrarias en `global_config`.
const nivelSchema = z.object({
  nombre: z.string().trim().min(1).max(60),
  desde: z.number().finite().nonnegative(),
}).catchall(z.unknown());

const configPatchSchema = z.object({
  cancelacion_min: z.number().finite().nonnegative().optional(),
  google_maps_url: z.url().optional(),
  costo_por_km: z.number().finite().nonnegative().optional(),
  tiempo_entrega_min: z.number().finite().nonnegative().optional(),
  radio_delivery_km: z.number().finite().positive().max(100).optional(),
  local_lat: z.number().min(-90).max(90).optional(),
  local_lng: z.number().min(-180).max(180).optional(),
  modo_pausa: z.boolean().optional(),
  horario_apertura: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horario inválido (HH:MM)").optional(),
  horario_cierre: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Horario inválido (HH:MM)").optional(),
  negocio_nombre: z.string().trim().min(1).max(80).optional(),
  agente_activo: z.boolean().optional(),
  agente_audios: z.boolean().optional(),
  agente_nombre: z.string().trim().min(1).max(40).optional(),
  agente_tono: z.string().trim().min(1).max(200).optional(),
  agente_instrucciones: z.string().trim().max(1000).optional(),
  puntos_por_100: z.number().finite().nonnegative().optional(),
  puntos_minimos: z.number().finite().nonnegative().optional(),
  puntos_vencimiento_dias: z.number().finite().nonnegative().optional(),
  puntos_bienvenida: z.number().finite().nonnegative().optional(),
  notif_webhook: z.union([z.url(), z.literal("")]).optional(),
  notif_email_from: z.union([z.email(), z.literal("")]).optional(),
  notif_template: z.string().max(4000).optional(),
  niveles_lealtad: z.array(nivelSchema).max(20).optional(),
  promos_del_dia: promoListSchema.optional(),
  [DAILY_SUMMARY_KEY]: dailySummarySettingsSchema.optional(),
  [COURIER_ASSIGN_MODE_KEY]: z.enum(COURIER_ASSIGN_MODES).optional(),
}).strict();

function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("global_config")
    .select("key, value");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const config = Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
  return NextResponse.json(config);
}

export async function PATCH(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const parsed = configPatchSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
  }

  const rows: Array<{ key: string; value: Json }> = Object.entries(parsed.data).map(
    ([key, value]) => ({ key, value: value as Json }),
  );
  if (rows.length === 0) return NextResponse.json({ ok: true });

  const supabase = createAdminClient();
  const { error } = await supabase
    .from("global_config")
    .upsert(rows, { onConflict: "key" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
