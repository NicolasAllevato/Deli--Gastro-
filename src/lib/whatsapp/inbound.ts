import { safeError } from "./privacy.ts";
import { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import type { InboundMessage, OutboundEcho, WebhookEvent } from "./payload.ts";
import { normalizePhone, samePhone } from "./phone.ts";
import type { WhatsAppSettings } from "./config.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];

const UNIQUE_VIOLATION = "23505";
const MAX_CLIENTS_SCANNED = 2000;

export interface InboundContext {
  db: Db;
  conversation: Conversation;
  message: InboundMessage;
  /** Id de la fila guardada en `wa_messages`. */
  messageId: string;
}

/** Lo que hace el agente con cada mensaje nuevo (se conecta en la Fase 4). */
export type InboundHandler = (ctx: InboundContext) => Promise<void>;

async function findClientId(db: Db, phone: string): Promise<string | null> {
  const { data } = await db.from("clients").select("id, phone").not("phone", "is", null).limit(MAX_CLIENTS_SCANNED);
  return (data ?? []).find((c) => c.phone && samePhone(c.phone, phone))?.id ?? null;
}

async function upsertConversation(db: Db, message: Pick<InboundMessage, "from" | "name">): Promise<Conversation> {
  const phone = normalizePhone(message.from);

  const read = async () =>
    (await db.from("wa_conversations").select("*").eq("client_phone", phone).maybeSingle()).data;

  const existing = await read();
  if (existing) {
    const changes: Database["public"]["Tables"]["wa_conversations"]["Update"] = {};
    if (!existing.contact_name && message.name) changes.contact_name = message.name;
    if (!existing.client_id) changes.client_id = await findClientId(db, phone);
    if (Object.values(changes).every((v) => v === null || v === undefined)) return existing;
    const { data } = await db.from("wa_conversations").update(changes).eq("id", existing.id).select().single();
    return data ?? existing;
  }

  const { data, error } = await db
    .from("wa_conversations")
    .insert({ client_phone: phone, client_id: await findClientId(db, phone), contact_name: message.name })
    .select()
    .single();
  if (!error && data) return data;

  // Dos mensajes simultáneos del mismo teléfono: el segundo insert pierde la carrera.
  const raced = error?.code === UNIQUE_VIOLATION ? await read() : null;
  if (raced) return raced;
  throw new Error(`No se pudo crear la conversación: ${error?.message ?? "sin datos"}`);
}

async function handleMessage(
  db: Db,
  message: InboundMessage,
  settings: WhatsAppSettings,
  handler: InboundHandler | undefined,
): Promise<void> {
  // Meta puede notificar varios números de la misma app: solo atendemos el configurado.
  if (settings.phoneNumberId && message.phoneNumberId !== settings.phoneNumberId) return;

  // Meta reintenta si tardamos: el mismo wamid no se procesa dos veces.
  const { data: seen } = await db.from("wa_messages").select("id").eq("wamid", message.wamid).maybeSingle();
  if (seen) return;

  const conversation = await upsertConversation(db, message);
  const { content } = message;

  const { data: saved, error } = await db
    .from("wa_messages")
    .insert({
      conversation_id: conversation.id,
      wamid: message.wamid,
      direction: "in",
      type: content.type === "unsupported" ? "unsupported" : content.type,
      body: content.type === "text" ? content.text : null,
    })
    .select("id")
    .single();
  if (error) {
    if (error.code === UNIQUE_VIOLATION) return;
    throw new Error(`No se pudo guardar el mensaje: ${error.message}`);
  }

  await db
    .from("wa_conversations")
    .update({ last_inbound_at: new Date().toISOString() })
    .eq("id", conversation.id);

  await handler?.({ db, conversation, message, messageId: saved.id });
}

/**
 * Guarda como saliente lo que el local mandó desde su número, para que el hilo y el historial del
 * agente queden completos. No dispara al agente ni abre la ventana de 24 h: eso solo lo hace el cliente.
 */
async function handleEcho(db: Db, echo: OutboundEcho, settings: WhatsAppSettings): Promise<void> {
  if (settings.phoneNumberId && echo.phoneNumberId !== settings.phoneNumberId) return;

  // Lo enviado desde Conversaciones ya está guardado con este mismo wamid.
  const { data: seen } = await db.from("wa_messages").select("id").eq("wamid", echo.wamid).maybeSingle();
  if (seen) return;

  const conversation = await upsertConversation(db, { from: echo.to, name: null });
  const { content } = echo;
  const { error } = await db.from("wa_messages").insert({
    conversation_id: conversation.id,
    wamid: echo.wamid,
    direction: "out",
    type: content.type === "unsupported" ? "unsupported" : content.type,
    body: content.type === "text" ? content.text : null,
    status: "sent",
  });
  if (error && error.code !== UNIQUE_VIOLATION) {
    throw new Error(`No se pudo guardar el mensaje enviado: ${error.message}`);
  }
}

/**
 * Procesa las notificaciones ya validadas de Meta. Un evento con error no frena
 * a los demás: se registra y se sigue.
 */
export async function processWebhookEvents(
  db: Db,
  events: readonly WebhookEvent[],
  settings: WhatsAppSettings,
  handler?: InboundHandler,
): Promise<void> {
  for (const event of events) {
    try {
      if (event.kind === "status") {
        await db.from("wa_messages").update({ status: event.status }).eq("wamid", event.wamid);
      } else if (event.kind === "echo") {
        await handleEcho(db, event, settings);
      } else {
        await handleMessage(db, event, settings, handler);
      }
    } catch (error: unknown) {
      console.error("[whatsapp] evento no procesado", event.kind, event.wamid, safeError(error));
    }
  }
}
