import { safeError } from "./privacy.ts";
import { createAdminClient } from "@/utils/supabase/admin";
import { clientFor, loadWhatsAppSettings } from "./config.ts";
import { normalizePhone } from "./phone.ts";
import { selectRecipients, type Recipient, type Segment } from "./segments.ts";
import { renderPreview, sanitizeParam, templateByName } from "./templates.ts";

type Db = ReturnType<typeof createAdminClient>;

/** Tope por campaña y por día: protege la calidad del número y el gasto del dueño. */
export const MAX_RECIPIENTS = 200;
export const MAX_CAMPAIGNS_PER_DAY = 2;
const DAY_MS = 86_400_000;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";

/** Destinatarios actuales de un segmento (clientes con teléfono que aceptaron promociones). */
export async function resolveRecipients(db: Db, segment: Segment): Promise<Recipient[]> {
  const [{ data: clients }, { data: orders }, { data: conversations }] = await Promise.all([
    db.from("clients").select("id, name, tier, wa_marketing_opt_in").eq("wa_marketing_opt_in", true),
    db.from("orders").select("client_id, created_at, status"),
    db.from("wa_conversations").select("client_id, client_phone").not("client_id", "is", null),
  ]);
  // El teléfono del perfil no está verificado: se escribe al número desde el que el cliente dio el alta.
  const verifiedPhone = new Map((conversations ?? []).map((c) => [c.client_id, c.client_phone]));
  return selectRecipients(
    (clients ?? []).map((c) => ({
      id: c.id, name: c.name, phone: verifiedPhone.get(c.id) ?? null, tier: c.tier, optedIn: c.wa_marketing_opt_in,
    })),
    orders ?? [],
    segment,
  );
}

/** Campañas creadas en las últimas 24 h (las fallidas no cuentan). */
export async function campaignsToday(db: Db, now: Date = new Date()): Promise<number> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const { data } = await db.from("wa_campaigns").select("id, status").gte("created_at", since);
  return (data ?? []).filter((c) => c.status !== "failed").length;
}

/**
 * Envía la plantilla de promoción a cada destinatario, de a uno. Una falla individual no
 * corta la campaña; al terminar queda el recuento y el estado.
 */
export async function runCampaign(db: Db, campaignId: string, recipients: readonly Recipient[], message: string): Promise<void> {
  const template = templateByName("promocion");
  const wa = clientFor(await loadWhatsAppSettings(db));
  let sent = 0;
  let failed = 0;

  if (!template || !wa) {
    await db.from("wa_campaigns").update({ status: "failed", finished_at: new Date().toISOString() }).eq("id", campaignId);
    return;
  }

  for (const recipient of recipients) {
    try {
      const params = [firstName(recipient.name), sanitizeParam(message)];
      const to = normalizePhone(recipient.phone);
      const wamid = await wa.sendTemplate(to, template.name, template.language, params);
      sent += 1;

      // Queda en el historial de la conversación, si el cliente ya tiene una.
      const { data: conversation } = await db.from("wa_conversations").select("id").eq("client_phone", to).maybeSingle();
      if (conversation) {
        await db.from("wa_messages").insert({
          conversation_id: conversation.id, wamid, direction: "out", type: "template",
          body: renderPreview(template, params),
        });
      }
    } catch (error: unknown) {
      failed += 1;
      console.error("[campaña] no se pudo enviar a", recipient.id, safeError(error));
    }
  }

  await db
    .from("wa_campaigns")
    .update({ status: sent === 0 && failed > 0 ? "failed" : "done", sent, failed, finished_at: new Date().toISOString() })
    .eq("id", campaignId);
}
