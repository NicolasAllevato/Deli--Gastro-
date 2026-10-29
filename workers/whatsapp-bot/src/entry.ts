/**
 * Entrada de mensajes del Worker (fase 3): guarda cada evento de Meta y pasa los mensajes al apilador.
 * Todo mensaje queda en `wa_messages` aunque el bot no responda: así el panel muestra la conversación completa
 * (coexistencia con la atención humana desde /admin/conversaciones).
 */
import type { InboundMessage, WebhookEvent } from "../../../src/lib/whatsapp/payload.ts";
import type { CoexistenceEvent, SmbEchoEvent } from "../../../src/lib/whatsapp/coexistence.ts";
import { HISTORY_DECLINED_CODE } from "../../../src/lib/whatsapp/coexistence.ts";
import { MIN_DIGITS, normalizePhone } from "../../../src/lib/whatsapp/phone.ts";
import type { BufferedMessage } from "./batching.ts";
import type { InboundRepo, InboundRow } from "./repo/types.ts";

export interface EntryDeps {
  repo: InboundRepo;
  /** Phone Number ID configurado: Meta puede notificar otros números de la misma app. */
  phoneNumberId: string | null;
  /** Agrega el mensaje al lote de su conversación (Durable Object). */
  buffer: (phone: string, message: BufferedMessage) => Promise<void>;
  log: (message: string, detail?: unknown) => void;
  /** Reloj (ms). Solo para los tests; por defecto `Date.now`. */
  now?: () => number;
}

/** Un eco con fecha más de 5 minutos en el futuro no es creíble: se descarta. */
const MAX_FUTURE_SKEW_MS = 5 * 60_000;

/** Eventos de `account_update` que cortan o cambian la coexistencia: se registran como alerta. */
const ALERT_ACCOUNT_EVENTS = new Set(["PARTNER_REMOVED", "ACCOUNT_OFFBOARDED", "ACCOUNT_RECONNECTED"]);

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

function echoRow(echo: SmbEchoEvent): InboundRow | null {
  const { content } = echo;
  if (content.type === "text") return { wamid: echo.wamid, type: "text", body: content.text };
  if (content.type === "media") return { wamid: echo.wamid, type: content.mediaType, body: content.label };
  if (content.type === "unsupported") return { wamid: echo.wamid, type: "unsupported", body: null };
  return null;
}

/**
 * Eco de la app WhatsApp Business: una persona le escribió al cliente desde el celular del local.
 * Se guarda como saliente, se pausa el bot en ese chat y NO se apila: el bot nunca responde ni lo trata como del cliente.
 * Falla cerrado: sin número configurado, con otro número, con teléfono o fecha inválidos, el eco se ignora (sin PII en el log).
 */
async function handleEcho(echo: SmbEchoEvent, deps: EntryDeps, minutesOf: () => Promise<number>): Promise<void> {
  if (!deps.phoneNumberId || echo.phoneNumberId !== deps.phoneNumberId) {
    deps.log("[whatsapp-bot] eco ignorado: el número no coincide o no hay número configurado");
    return;
  }
  const row = echoRow(echo);
  if (!row) {
    deps.log("[whatsapp-bot] eco edit/revoke ignorado", { type: echo.content.type === "ignored" ? echo.content.rawType : null });
    return;
  }
  const phone = normalizePhone(echo.to);
  if (phone.length < MIN_DIGITS) {
    deps.log("[whatsapp-bot] eco ignorado: destinatario inválido");
    return;
  }
  const now = deps.now?.() ?? Date.now();
  const declared = echo.timestamp > 0 ? echo.timestamp * 1000 : now;
  if (declared > now + MAX_FUTURE_SKEW_MS) {
    deps.log("[whatsapp-bot] eco ignorado: fecha en el futuro");
    return;
  }
  // Un eco repetido, o un mensaje que mandó el propio bot, ya está como saliente: no pausa (evita la autopausa).
  if (await deps.repo.hasOutbound(echo.wamid)) return;

  const conversation = await deps.repo.ensureConversation(phone);
  if (!(await deps.repo.saveEcho(conversation.id, row))) return;
  const sentAt = Math.min(declared, now);
  await deps.repo.pauseBot(conversation.id, new Date(sentAt + (await minutesOf()) * 60_000));
}

/** `history`, `smb_app_state_sync` y `account_update`: solo conteos o el nombre del evento (sin datos personales). */
function logInformational(event: Exclude<CoexistenceEvent, SmbEchoEvent>, deps: EntryDeps): void {
  if (event.kind === "history") {
    if (event.errorCode === HISTORY_DECLINED_CODE) deps.log("[whatsapp-bot] history rechazado por el usuario", { code: event.errorCode });
    else if (event.rejected) deps.log("[whatsapp-bot] history con error", { code: event.errorCode });
    else deps.log("[whatsapp-bot] history ignorado", { phase: event.phase, chunk: event.chunk, threads: event.threads, messages: event.messages });
  } else if (event.kind === "app_state_sync") {
    deps.log("[whatsapp-bot] smb_app_state_sync ignorado", { contacts: event.contacts });
  } else if (ALERT_ACCOUNT_EVENTS.has(event.event)) {
    // deli_bot no puede escribir global_config (migración 015): la marca consultable es este log (Workers Observability).
    deps.log("[whatsapp-bot] ALERTA coexistencia: account_update", { event: event.event });
  } else {
    deps.log("[whatsapp-bot] account_update", { event: event.event });
  }
}

function describeEvent(event: WebhookEvent | CoexistenceEvent): string {
  return "wamid" in event ? `${event.kind} ${event.wamid}` : event.kind;
}

/** Procesa los eventos ya validados. Los ecos van primero (pausan antes de que se evalúe un mensaje del mismo payload). */
export async function handleWebhookEvents(events: readonly (WebhookEvent | CoexistenceEvent)[], deps: EntryDeps): Promise<void> {
  const ordered = [...events.filter((e) => e.kind === "smb_echo"), ...events.filter((e) => e.kind !== "smb_echo")];
  // Los minutos de pausa se consultan una sola vez por payload.
  let minutes: Promise<number> | null = null;
  const minutesOf = () => (minutes ??= deps.repo.takeoverMinutes());
  for (const event of ordered) {
    try {
      if (event.kind === "status") await deps.repo.updateStatus(event.wamid, event.status);
      else if (event.kind === "message") await handleMessage(event, deps);
      else if (event.kind === "smb_echo") await handleEcho(event, deps, minutesOf);
      else if (event.kind !== "echo") logInformational(event, deps);
    } catch (error: unknown) {
      deps.log(`[whatsapp-bot] evento no procesado ${describeEvent(event)}`, error instanceof Error ? error.message : error);
    }
  }
}
