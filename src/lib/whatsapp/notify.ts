import { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import { formatMoney, formatOrderId } from "@/lib/orders";
import { loadAgentSettings } from "@/lib/agent/settings";
import { clientFor, loadWhatsAppSettings } from "./config.ts";
import { normalizePhone } from "./phone.ts";
import { renderPreview, sanitizeParam, templateByName } from "./templates.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

export type OrderNotice = "created" | "En Preparación" | "En Camino" | "Finalizados";

const SURVEY_MIN_DELAY_MIN = 30;
const SURVEY_MAX_AGE_MIN = 180;
const SURVEY_BATCH = 50;
const MINUTE_MS = 60_000;

const firstName = (name: string) => name.trim().split(/\s+/)[0] || "";

/**
 * La conversación de un cliente, si alguna vez le escribió al local. Es la señal de que
 * aceptó hablar por WhatsApp: sin ella no se le mandan avisos.
 */
export async function findConversation(db: Db, clientId: string, phone: string | null): Promise<Conversation | null> {
  const byClient = await db.from("wa_conversations").select("*").eq("client_id", clientId).limit(1);
  if (byClient.data?.[0]) return byClient.data[0];
  if (!phone) return null;
  const byPhone = await db.from("wa_conversations").select("*").eq("client_phone", normalizePhone(phone)).limit(1);
  return byPhone.data?.[0] ?? null;
}

interface Target {
  order: OrderRow;
  name: string;
  conversation: Conversation;
}

async function loadTarget(db: Db, order: OrderRow): Promise<Target | null> {
  if (!order.client_id) return null;
  const { data: client } = await db.from("clients").select("name, phone").eq("id", order.client_id).maybeSingle();
  if (!client?.phone) return null;
  const conversation = await findConversation(db, order.client_id, client.phone);
  return conversation ? { order, name: firstName(client.name), conversation } : null;
}

async function sendTemplateTo(db: Db, conversation: Conversation, templateName: string, params: readonly string[]) {
  const template = templateByName(templateName);
  const wa = clientFor(await loadWhatsAppSettings(db));
  if (!template || !wa) return false;

  const clean = params.map(sanitizeParam);
  const wamid = await wa.sendTemplate(conversation.client_phone, template.name, template.language, clean);
  await db.from("wa_messages").insert({
    conversation_id: conversation.id,
    wamid,
    direction: "out",
    type: "template",
    body: renderPreview(template, clean),
  });
  return true;
}

function paramsFor(notice: OrderNotice, target: Target, estimatedMinutes: number): [string, string[]] | null {
  const code = formatOrderId(target.order.id);
  switch (notice) {
    case "created":
      return ["confirmacion_pedido", [target.name, code, formatMoney(Number(target.order.total)), String(estimatedMinutes)]];
    case "En Preparación":
      return ["pedido_en_preparacion", [target.name, code]];
    case "En Camino":
      return ["pedido_en_camino", [target.name, code, target.order.courier_name ?? "nuestro repartidor"]];
    case "Finalizados":
      return ["pedido_entregado", [target.name, code]];
  }
}

/**
 * Avisa al cliente por WhatsApp (plantillas de utilidad). No hace nada si WhatsApp no está
 * conectado o si el cliente nunca le escribió al local. Nunca lanza: un aviso fallido no
 * debe afectar al pedido.
 */
export async function notifyOrderEvent(db: Db, orderId: string, notice: OrderNotice): Promise<void> {
  try {
    const { data: order } = await db.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (!order) return;
    // Los pedidos hechos por WhatsApp ya se confirman dentro del chat.
    if (notice === "created" && order.channel === "whatsapp") return;

    const target = await loadTarget(db, order);
    if (!target) return;

    const { estimatedMinutes } = await loadAgentSettings(db);
    const built = paramsFor(notice, target, estimatedMinutes);
    if (built) await sendTemplateTo(db, target.conversation, built[0], built[1]);
  } catch (error: unknown) {
    console.error("[whatsapp] no se pudo avisar el pedido", orderId, notice, error);
  }
}

/**
 * Manda la encuesta de satisfacción a los pedidos entregados hace entre 30 min y 3 h que
 * todavía no tienen reseña ni encuesta. Pensada para correr cada pocos minutos (cron).
 */
export async function sendDueSurveys(db: Db, appUrl: string, now: Date = new Date()): Promise<{ sent: number }> {
  const from = new Date(now.getTime() - SURVEY_MAX_AGE_MIN * MINUTE_MS).toISOString();
  const to = new Date(now.getTime() - SURVEY_MIN_DELAY_MIN * MINUTE_MS).toISOString();

  const { data: due } = await db
    .from("orders")
    .select("*")
    .eq("status", "Finalizados")
    .is("survey_sent_at", null)
    .gte("delivered_at", from)
    .lte("delivered_at", to)
    .limit(SURVEY_BATCH);
  const orders = due ?? [];
  if (orders.length === 0) return { sent: 0 };

  const { data: reviews } = await db.from("reviews").select("order_id").in("order_id", orders.map((o) => o.id));
  const reviewed = new Set((reviews ?? []).map((r) => r.order_id));

  let sent = 0;
  for (const order of orders) {
    if (reviewed.has(order.id)) continue;
    try {
      const target = await loadTarget(db, order);
      if (!target) continue;
      const link = `${appUrl.replace(/\/$/, "")}/cliente/resenas/${order.id}`;
      const ok = await sendTemplateTo(db, target.conversation, "encuesta_satisfaccion", [
        target.name, formatOrderId(order.id), link,
      ]);
      if (!ok) continue;
      await db.from("orders").update({ survey_sent_at: now.toISOString() }).eq("id", order.id);
      sent += 1;
    } catch (error: unknown) {
      console.error("[whatsapp] no se pudo enviar la encuesta", order.id, error);
    }
  }
  return { sent };
}

export { sendTemplateTo };
