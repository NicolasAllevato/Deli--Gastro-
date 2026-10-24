import { z } from "zod";
import type { DeliveryStatus, InboundContent, WebhookEvent } from "./payload.ts";
import { normalizePhone } from "./phone.ts";

// OpenWA (rmyndharis/OpenWA) como canal de WhatsApp por QR, para pruebas. La producción con
// clientes va por Meta Cloud API: OpenWA no tiene plantillas ni ventana de 24 h, y un número
// por QR que escribe en frío o en masa se banea. Por eso la app aplica igual la regla de 24 h.

const REQUEST_TIMEOUT_MS = 15_000;

type Env = Readonly<Record<string, string | undefined>>;

export interface OpenWAConfig {
  url: string;
  apiKey: string;
  sessionId: string;
}

/** Datos para hablar con OpenWA; null si falta alguno (el canal queda apagado). */
export function openwaConfigFromEnv(env: Env = process.env): OpenWAConfig | null {
  const url = env.OPENWA_URL?.trim().replace(/\/+$/, "");
  const apiKey = env.OPENWA_API_KEY?.trim();
  const sessionId = env.OPENWA_SESSION_ID?.trim();
  return url && apiKey && sessionId ? { url, apiKey, sessionId } : null;
}

/** ¿Las respuestas salen por OpenWA en lugar de Meta? */
export function isOpenWAProvider(env: Env = process.env): boolean {
  return env.WHATSAPP_PROVIDER?.trim().toLowerCase() === "openwa";
}

export class OpenWAApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenWAApiError";
    this.status = status;
  }
}

/** Solo chats 1 a 1: los grupos (`@g.us`), estados y canales no entran a Conversaciones. */
export const chatIdFor = (phone: string) => `${normalizePhone(phone)}@c.us`;

export function createOpenWAClient(cfg: OpenWAConfig, fetchImpl: typeof fetch = fetch) {
  async function sendText(to: string, text: string): Promise<string> {
    const res = await fetchImpl(`${cfg.url}/api/sessions/${encodeURIComponent(cfg.sessionId)}/messages/send-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": cfg.apiKey },
      body: JSON.stringify({ chatId: chatIdFor(to), text }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as { messageId?: string; message?: string | string[] };
    if (!res.ok) {
      const detail = Array.isArray(json.message) ? json.message.join(", ") : json.message;
      throw new OpenWAApiError(res.status, detail ?? `Error ${res.status} de OpenWA`);
    }
    if (!json.messageId) throw new OpenWAApiError(502, "OpenWA no devolvió el id del mensaje.");
    return json.messageId;
  }

  return { sendText };
}

const envelope = z.object({
  event: z.string(),
  sessionId: z.string(),
  data: z.unknown(),
});

const received = z.object({
  id: z.string().min(1),
  from: z.string().min(1),
  chatId: z.string().optional(),
  body: z.string().nullish(),
  type: z.string().default("text"),
  timestamp: z.number().optional(),
  fromMe: z.boolean().optional(),
  kind: z.string().optional(),
  /** Con `RESOLVE_LID_TO_PHONE=true`, el teléfono real cuando WhatsApp manda un id de privacidad (`@lid`). */
  senderPhone: z.string().nullish(),
  contact: z.object({ name: z.string().nullish(), pushName: z.string().nullish() }).nullish(),
});

const ack = z.object({
  messageId: z.string().min(1),
  status: z.enum(["pending", "sent", "delivered", "read", "failed"]),
  chatId: z.string().optional(),
});

const PHONE_JID = /^(\d+)@(c\.us|s\.whatsapp\.net)$/;

/** Teléfono del remitente, o null si es un id `@lid` sin resolver (no se le podría responder). */
function senderPhoneOf(msg: z.infer<typeof received>): string | null {
  if (msg.senderPhone) return normalizePhone(msg.senderPhone) || null;
  return PHONE_JID.exec(msg.chatId ?? msg.from)?.[1] ?? null;
}

function contentOf(msg: z.infer<typeof received>): InboundContent {
  if (msg.type === "text" && msg.body) return { type: "text", text: msg.body };
  return { type: "unsupported", rawType: msg.type };
}

/**
 * Traduce un evento de webhook de OpenWA al formato común de la app (el mismo que sale de Meta),
 * así lo guarda `processWebhookEvents` sin saber de dónde vino. Lo que no es un chat 1 a 1 se descarta.
 */
export function parseOpenWAWebhook(payload: unknown): WebhookEvent[] {
  const env = envelope.safeParse(payload);
  if (!env.success) return [];

  if (env.data.event === "message.received") {
    const msg = received.safeParse(env.data.data);
    if (!msg.success || msg.data.fromMe) return [];
    if (msg.data.kind && msg.data.kind !== "individual") return [];
    const from = senderPhoneOf(msg.data);
    if (!from) return [];
    return [{
      kind: "message",
      wamid: msg.data.id,
      from,
      name: msg.data.contact?.pushName ?? msg.data.contact?.name ?? null,
      timestamp: msg.data.timestamp ?? 0,
      phoneNumberId: env.data.sessionId,
      content: contentOf(msg.data),
    }];
  }

  if (env.data.event === "message.ack") {
    const a = ack.safeParse(env.data.data);
    if (!a.success || a.data.status === "pending") return [];
    return [{
      kind: "status",
      wamid: a.data.messageId,
      status: a.data.status as DeliveryStatus,
      recipient: a.data.chatId ? normalizePhone(a.data.chatId.split("@")[0]) : "",
      timestamp: 0,
    }];
  }

  return [];
}
