/**
 * Entrada de mensajes del Worker (fase 3): guarda cada evento de Meta y pasa los mensajes al apilador.
 * Todo mensaje queda en `wa_messages` aunque el bot no responda: así el panel muestra la conversación completa
 * (coexistencia con la atención humana desde /admin/conversaciones).
 */
import type { InboundMessage, WebhookEvent } from "../../../src/lib/whatsapp/payload.ts";
import type { CoexistenceEvent, SmbEchoEvent } from "../../../src/lib/whatsapp/coexistence.ts";
import { normalizePhone } from "../../../src/lib/whatsapp/phone.ts";
import type { BufferedMessage } from "./batching.ts";
import type { InboundRepo, InboundRow } from "./repo/types.ts";

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

/**
 * Eco de la app WhatsApp Business: una persona le escribió al cliente desde el celular del local.
 * Se guarda como saliente, se pausa el bot en ese chat y NO se apila: el bot nunca responde ni lo trata como del cliente.
 */
async function handleEcho(echo: SmbEchoEvent, deps: EntryDeps): Promise<void> {
  if (deps.phoneNumberId && echo.phoneNumberId !== deps.phoneNumberId) return;

  const phone = normalizePhone(echo.to);
  const minutes = await deps.repo.takeoverMinutes();
  // Se cuenta desde el momento del eco: un reintento repetido da el mismo valor y uno tardío no extiende la pausa.
  const sentAt = echo.timestamp > 0 ? echo.timestamp * 1000 : Date.now();
  const conversation = await deps.repo.pauseBot(phone, new Date(sentAt + minutes * 60_000));
  const row: InboundRow =
    echo.content.type === "text"
      ? { wamid: echo.wamid, type: "text", body: echo.content.text }
      : { wamid: echo.wamid, type: "unsupported", body: null };
  await deps.repo.saveEcho(conversation.id, row);
}

/** `history`, `smb_app_state_sync` y `account_update`: solo conteos o el nombre del evento (sin datos personales). */
function logInformational(event: Exclude<CoexistenceEvent, SmbEchoEvent>, deps: EntryDeps): void {
  if (event.kind === "history") {
    deps.log("[whatsapp-bot] history ignorado", { phase: event.phase, chunk: event.chunk, threads: event.threads, messages: event.messages });
  } else if (event.kind === "app_state_sync") {
    deps.log("[whatsapp-bot] smb_app_state_sync ignorado", { contacts: event.contacts });
  } else {
    deps.log("[whatsapp-bot] account_update", { event: event.event });
  }
}

function describeEvent(event: WebhookEvent | CoexistenceEvent): string {
  return "wamid" in event ? `${event.kind} ${event.wamid}` : event.kind;
}

/** Procesa los eventos ya validados. Un evento con error se registra y no frena a los demás. */
export async function handleWebhookEvents(events: readonly (WebhookEvent | CoexistenceEvent)[], deps: EntryDeps): Promise<void> {
  for (const event of events) {
    try {
      if (event.kind === "status") await deps.repo.updateStatus(event.wamid, event.status);
      else if (event.kind === "message") await handleMessage(event, deps);
      else if (event.kind === "smb_echo") await handleEcho(event, deps);
      else if (event.kind !== "echo") logInformational(event, deps);
    } catch (error: unknown) {
      deps.log(`[whatsapp-bot] evento no procesado ${describeEvent(event)}`, error instanceof Error ? error.message : error);
    }
  }
}
