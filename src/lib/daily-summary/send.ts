import { createAdminClient } from "@/utils/supabase/admin";
import type { Json } from "@/types/database";
import type { ReportOrder } from "@/lib/reports/analytics";
import type { Bounds } from "@/lib/reports/range";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import type { WhatsAppClient } from "@/lib/whatsapp/client";
import { sanitizeParam, templateByName } from "@/lib/whatsapp/templates";
import { emailConfig, sendEmail as sendViaProvider, type EmailConfig, type EmailMessage } from "./email.ts";
import {
  DAILY_SUMMARY_KEY,
  DAILY_SUMMARY_LAST_KEY,
  hasContact,
  isDue,
  localClock,
  parseLastSend,
  parseSettings,
  type DailySummarySettings,
  type LastSend,
} from "./settings.ts";
import { buildDailySummary, renderEmail, whatsappParams } from "./summary.ts";

type Db = ReturnType<typeof createAdminClient>;

const DAY_MS = 24 * 60 * 60 * 1000;
const OFFSET_MS = 3 * 60 * 60 * 1000;
const MAX_ORDERS = 5000;
const ORDER_COLUMNS =
  "id, client_id, status, total, delivery_fee, channel, payment_method, items_desc, created_at, accepted_at, ready_at, picked_up_at, delivered_at";

export const SUMMARY_TEMPLATE = "resumen_diario";

export type ChannelStatus = "enviado" | "sin-configurar" | "sin-destinatarios";

export interface SendReport {
  date: string;
  email: { sent: number; failed: number; status: ChannelStatus };
  whatsapp: { sent: number; failed: number; status: ChannelStatus };
}

/** Dependencias reemplazables para probar sin salir a internet. */
export interface SendDeps {
  email?: EmailConfig | null;
  sendEmail?: (config: EmailConfig, message: Omit<EmailMessage, "from">) => Promise<void>;
  whatsapp?: WhatsAppClient | null;
}

/** Límites del día de Buenos Aires que contiene a `now`: [medianoche, medianoche siguiente). */
function dayBounds(now: Date): Bounds {
  const start = Math.floor((now.getTime() - OFFSET_MS) / DAY_MS) * DAY_MS + OFFSET_MS;
  return { from: new Date(start).toISOString(), to: new Date(start + DAY_MS).toISOString() };
}

async function loadConfig(db: Db) {
  const { data, error } = await db
    .from("global_config")
    .select("key, value")
    .in("key", [DAILY_SUMMARY_KEY, DAILY_SUMMARY_LAST_KEY, "negocio_nombre", "notif_email_from"]);
  if (error) throw new Error(`No se pudo leer la configuración: ${error.message}`);
  const byKey = new Map((data ?? []).map((r) => [r.key, r.value]));
  const text = (key: string) => (typeof byKey.get(key) === "string" ? (byKey.get(key) as string) : undefined);
  return {
    settings: parseSettings(byKey.get(DAILY_SUMMARY_KEY)),
    last: parseLastSend(byKey.get(DAILY_SUMMARY_LAST_KEY)),
    businessName: text("negocio_nombre")?.trim() || "Tu local",
    emailFrom: text("notif_email_from"),
  };
}

async function loadDayOrders(db: Db, bounds: Bounds): Promise<ReportOrder[]> {
  const { data, error } = await db
    .from("orders")
    .select(ORDER_COLUMNS)
    .gte("created_at", bounds.from)
    .lt("created_at", bounds.to)
    .limit(MAX_ORDERS);
  if (error) throw new Error(`No se pudieron leer los pedidos del día: ${error.message}`);
  return ((data ?? []) as unknown as ReportOrder[]).map((o) => ({
    ...o,
    total: Number(o.total),
    delivery_fee: Number(o.delivery_fee),
  }));
}

/** Arma el resumen del día de `now` y lo manda a cada destinatario activo, por mail y por WhatsApp. */
async function deliver(
  db: Db,
  settings: DailySummarySettings,
  ctx: { businessName: string; emailFrom: string | undefined },
  now: Date,
  deps: SendDeps,
): Promise<SendReport> {
  const date = localClock(now).date;
  const summary = buildDailySummary(await loadDayOrders(db, dayBounds(now)), dayBounds(now), date);
  const recipients = settings.destinatarios.filter(hasContact);

  const mail = deps.email === undefined ? emailConfig(ctx.emailFrom) : deps.email;
  const wa = deps.whatsapp === undefined ? clientFor(await loadWhatsAppSettings(db)) : deps.whatsapp;
  const template = templateByName(SUMMARY_TEMPLATE);
  const send = deps.sendEmail ?? ((config, message) => sendViaProvider(config, message));

  const report: SendReport = {
    date,
    email: { sent: 0, failed: 0, status: mail ? "enviado" : "sin-configurar" },
    whatsapp: { sent: 0, failed: 0, status: wa && template ? "enviado" : "sin-configurar" },
  };

  const rendered = renderEmail(summary, ctx.businessName);
  for (const person of recipients) {
    if (mail && person.email) {
      try {
        await send(mail, { to: person.email, subject: rendered.subject, text: rendered.text, html: rendered.html });
        report.email.sent += 1;
      } catch (error: unknown) {
        report.email.failed += 1;
        console.error("[resumen-diario] falló el mail", error instanceof Error ? error.message : error);
      }
    }
    if (wa && template && person.telefono) {
      try {
        const params = whatsappParams(summary, ctx.businessName, person.nombre.split(/\s+/)[0] ?? person.nombre).map(sanitizeParam);
        await wa.sendTemplate(person.telefono, template.name, template.language, params);
        report.whatsapp.sent += 1;
      } catch (error: unknown) {
        report.whatsapp.failed += 1;
        console.error("[resumen-diario] falló WhatsApp", error instanceof Error ? error.message : error);
      }
    }
  }

  if (!recipients.some((r) => r.email)) report.email.status = "sin-destinatarios";
  if (!recipients.some((r) => r.telefono)) report.whatsapp.status = "sin-destinatarios";
  return report;
}

/** Envío manual de prueba desde el panel: manda el resumen de hoy a los destinatarios activos sin marcar el día como enviado. */
export async function sendDailySummaryNow(db: Db, now: Date = new Date(), deps: SendDeps = {}): Promise<SendReport> {
  const config = await loadConfig(db);
  return deliver(db, config.settings, config, now, deps);
}

/** Lo llama el cron: envía el resumen una sola vez por día, pasada la hora de cierre. */
export async function runDailySummaryIfDue(
  db: Db,
  now: Date = new Date(),
  deps: SendDeps = {},
): Promise<{ sent: false; reason: string } | ({ sent: true } & SendReport)> {
  const config = await loadConfig(db);
  if (!isDue(config.settings, config.last, now)) return { sent: false, reason: "no corresponde enviar ahora" };

  const report = await deliver(db, config.settings, config, now, deps);
  const last: LastSend = {
    fecha: report.date,
    email: report.email.sent,
    whatsapp: report.whatsapp.sent,
    errores: report.email.failed + report.whatsapp.failed,
  };
  // Se marca el día aunque algún envío falle: reintentar cada 15 minutos spamearía a quienes ya lo recibieron.
  const { error } = await db
    .from("global_config")
    .upsert([{ key: DAILY_SUMMARY_LAST_KEY, value: last as unknown as Json }], { onConflict: "key" });
  if (error) console.error("[resumen-diario] no se pudo registrar el envío", error.message);
  return { sent: true, ...report };
}
