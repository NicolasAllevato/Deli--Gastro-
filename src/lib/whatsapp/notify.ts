import { safeError } from "./privacy.ts";
import { isFudoOrigin } from "@/lib/fudo/origin";
import { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import { formatMoney, formatOrderId } from "@/lib/orders";
import { loadAgentSettings } from "@/lib/agent/settings";
import { clientFor, loadWhatsAppSettings } from "./config.ts";
import { normalizePhone } from "./phone.ts";
import { runSurveys, type SurveyResult } from "./surveys.ts";
import { renderPreview, sanitizeParam, templateByName } from "./templates.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

export type OrderNotice = "created" | "En Preparación" | "En Camino" | "Finalizados";

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
  const body = renderPreview(template, clean);
  // Idempotencia: el mismo aviso (misma plantilla, pedido y datos) ya está en el historial → no se repite.
  const { data: previous } = await db
    .from("wa_messages")
    .select("id")
    .eq("conversation_id", conversation.id)
    .eq("type", "template")
    .eq("body", body)
    .limit(1);
  // Cuenta como entregado (true): la encuesta no se libera para reintentar algo que el cliente ya recibió.
  if ((previous ?? []).length > 0) return true;

  const wamid = await wa.sendTemplate(conversation.client_phone, template.name, template.language, clean);
  await db.from("wa_messages").insert({
    conversation_id: conversation.id,
    wamid,
    direction: "out",
    type: "template",
    body,
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
 * Los pedidos hechos por WhatsApp ya se confirman dentro del chat, salvo los pagados online: con Mercado Pago el
 * pedido nace al acreditarse el pago (webhook) y el chat no vio ninguna confirmación, así que SÍ se avisa.
 */
export function skipCreatedNotice(order: Pick<OrderRow, "channel" | "payment_method">): boolean {
  if (order.channel !== "whatsapp") return false;
  return String(order.payment_method ?? "").trim().toLowerCase() !== "mercado pago";
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
    if (isFudoOrigin(order)) return; // segundo resguardo: el PATCH ya los corta antes
    if (notice === "created" && skipCreatedNotice(order)) return;

    const target = await loadTarget(db, order);
    if (!target) return;

    const { estimatedMinutes } = await loadAgentSettings(db);
    const built = paramsFor(notice, target, estimatedMinutes);
    if (built) await sendTemplateTo(db, target.conversation, built[0], built[1]);
  } catch (error: unknown) {
    console.error("[whatsapp] no se pudo avisar el pedido", orderId, notice, safeError(error));
  }
}

/**
 * Manda la encuesta de satisfacción a los pedidos entregados hace entre 30 min y 3 h que
 * todavía no tienen reseña ni encuesta, entre las 9 y las 22 hs. Pensada para correr cada
 * pocos minutos (cron de Cloudflare). La lógica de reclamo y reintento está en `surveys.ts`.
 */
export async function sendDueSurveys(db: Db, appUrl: string, now: Date = new Date()): Promise<SurveyResult> {
  const base = appUrl.replace(/\/$/, "");

  return runSurveys<OrderRow, Target>({
    async listDue(from, to, limit) {
      const { data, error } = await db
        .from("orders")
        .select("*")
        .eq("status", "Finalizados")
        // Los pedidos nacidos en Fudo no reciben encuesta (los gestiona el local en Fudo).
        .neq("channel", "fudo")
        .is("survey_sent_at", null)
        .gte("delivered_at", from)
        .lte("delivered_at", to)
        .order("delivered_at", { ascending: true })
        .limit(limit);
      // Un error de base no es "no hay encuestas": que el cron lo vea fallar.
      if (error) throw new Error(`No se pudieron leer los pedidos: ${error.message}`);
      return data ?? [];
    },
    async reviewedIds(ids) {
      const { data, error } = await db.from("reviews").select("order_id").in("order_id", ids);
      if (error) throw new Error(`No se pudieron leer las reseñas: ${error.message}`);
      return new Set((data ?? []).map((r) => r.order_id));
    },
    loadTarget: (order) => loadTarget(db, order),
    async claim(orderId, nowIso) {
      const { data, error } = await db
        .from("orders")
        .update({ survey_sent_at: nowIso })
        .eq("id", orderId)
        .is("survey_sent_at", null)
        .select("id");
      if (error) throw new Error(`No se pudo reclamar la encuesta: ${error.message}`);
      return (data ?? []).length > 0;
    },
    async release(orderId, nowIso) {
      const { error } = await db
        .from("orders")
        .update({ survey_sent_at: null })
        .eq("id", orderId)
        .eq("survey_sent_at", nowIso);
      // supabase-js no lanza: sin esto un pedido quedaría reclamado sin encuesta y sin rastro.
      if (error) throw new Error(`No se pudo liberar la encuesta: ${error.message}`);
    },
    send: (order, target) =>
      sendTemplateTo(db, target.conversation, "encuesta_satisfaccion", [
        target.name, formatOrderId(order.id), `${base}/cliente/resenas/${order.id}`,
      ]),
  }, now);
}

export { sendTemplateTo };
