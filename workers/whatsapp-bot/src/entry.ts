/**
 * Entrada de mensajes del Worker (fase 3): guarda cada evento de Meta y pasa los mensajes al apilador.
 * Todo mensaje queda en `wa_messages` aunque el bot no responda: así el panel muestra la conversación completa
 * (coexistencia con la atención humana desde /admin/conversaciones).
 */
import type { InboundMessage, WebhookEvent } from "../../../src/lib/whatsapp/payload.ts";
import { normalizePhone } from "../../../src/lib/whatsapp/phone.ts";
import type { BufferedMessage } from "./batching.ts";
import type { InboundRepo, InboundRow } from "./repo/inbound.ts";

export interface EntryDeps {
  repo: InboundRepo;
  /** Phone Number ID configurado: Meta puede notificar otros números de la misma app. */
  phoneNumberId: string | null;
  /** Agrega el mensaje al lote de su conversación (Durable Object). */
  buffer: (phone: string, message: BufferedMessage) => Promise<void>;
  log: (message: string, detail?: unknown) => void;
}

function rowFor(message: InboundMessage): InboundRow {
  const { content } = message;
  if (content.type === "text") return { wamid: message.wamid, type: "text", body: content.text };
  if (content.type === "audio") return { wamid: message.wamid, type: "audio", body: null };
  return { wamid: message.wamid, type: "unsupported", body: null };
}

function bufferedFor(message: InboundMessage): BufferedMessage {
  const at = message.timestamp * 1000;
  const { content } = message;
  if (content.type === "text") return { wamid: message.wamid, text: content.text, at, kind: "text" };
  if (content.type === "audio") return { wamid: message.wamid, text: "", at, kind: "audio", mediaId: content.mediaId };
  return { wamid: message.wamid, text: `(mensaje de tipo ${content.rawType})`, at, kind: "other" };
}

async function handleMessage(message: InboundMessage, deps: EntryDeps): Promise<void> {
  if (deps.phoneNumberId && message.phoneNumberId !== deps.phoneNumberId) return;

  const phone = normalizePhone(message.from);
  const conversation = await deps.repo.upsertConversation(phone, message.name);
  const isNew = await deps.repo.saveInbound(conversation.id, rowFor(message));
  if (!isNew || conversation.humanTakeover) return;

  await deps.buffer(phone, bufferedFor(message));
}

/** Procesa los eventos ya validados. Un evento con error se registra y no frena a los demás. */
export async function handleWebhookEvents(events: readonly WebhookEvent[], deps: EntryDeps): Promise<void> {
  for (const event of events) {
    try {
      if (event.kind === "status") await deps.repo.updateStatus(event.wamid, event.status);
      else await handleMessage(event, deps);
    } catch (error: unknown) {
      deps.log(`[whatsapp-bot] evento no procesado ${event.kind} ${event.wamid}`, error instanceof Error ? error.message : error);
    }
  }
}
