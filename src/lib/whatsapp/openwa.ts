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

export interface EnsureActiveOptions {
  pollMs?: number;
  maxWaitMs?: number;
}

const DEFAULT_ENSURE: Required<EnsureActiveOptions> = { pollMs: 1_500, maxWaitMs: 20_000 };
const NOT_ACTIVE = /not active/i;

export function createOpenWAClient(
  cfg: OpenWAConfig,
  fetchImpl: typeof fetch = fetch,
  ensureOpts: EnsureActiveOptions = {},
) {
  const sessionPath = `${cfg.url}/api/sessions/${encodeURIComponent(cfg.sessionId)}`;
  const headers = { "Content-Type": "application/json", "X-API-Key": cfg.apiKey };

  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(`${sessionPath}${path}`, { ...init, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const json = (await res.json().catch(() => ({}))) as T & { message?: string | string[] };
    if (!res.ok) {
      const detail = Array.isArray(json.message) ? json.message.join(", ") : json.message;
      throw new OpenWAApiError(res.status, detail ?? `Error ${res.status} de OpenWA`);
    }
    return json;
  }

  const status = async () => (await call<{ status?: string }>("")).status ?? "unknown";

  /**
   * Deja la sesión en `ready` si solo está desconectada. OpenWA no retoma sola una sesión que el
   * contenedor anterior liberó al apagarse durante un redeploy. `failed` (otra instancia o número
   * bloqueado) y `qr_ready` (hay que escanear) necesitan a una persona, así que no se tocan.
   */
  async function ensureActive(opts: EnsureActiveOptions = ensureOpts): Promise<boolean> {
    const { pollMs, maxWaitMs } = { ...DEFAULT_ENSURE, ...opts };
    const current = await status();
    if (current === "ready") return true;
    if (current !== "disconnected") return false;

    await call("/start", { method: "POST" });
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, pollMs));
      const next = await status();
      if (next === "ready") return true;
      if (next !== "initializing" && next !== "authenticating") return false;
    }
    return false;
  }

  async function send(to: string, text: string): Promise<string> {
    const json = await call<{ messageId?: string }>("/messages/send-text", {
      method: "POST",
      body: JSON.stringify({ chatId: chatIdFor(to), text }),
    });
    if (!json.messageId) throw new OpenWAApiError(502, "OpenWA no devolvió el id del mensaje.");
    return json.messageId;
  }

  async function sendText(to: string, text: string): Promise<string> {
    try {
      return await send(to, text);
    } catch (error: unknown) {
      if (!(error instanceof OpenWAApiError) || !NOT_ACTIVE.test(error.message)) throw error;
      if (!(await ensureActive())) throw error;
      return send(to, text);
    }
  }

  return { sendText, ensureActive };
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

/** `message.sent`: lo que sale del número, escrito en el teléfono o mandado por la API. */
const sent = z.object({
  id: z.string().min(1),
  to: z.string().optional(),
  chatId: z.string().optional(),
  body: z.string().nullish(),
  type: z.string().default("text"),
  timestamp: z.number().optional(),
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

function contentOf(msg: { type: string; body?: string | null }): InboundContent {
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

  if (env.data.event === "message.sent") {
    // Así el hilo (y el historial que lee el agente) incluye lo que el local responde desde el
    // propio teléfono. Lo mandado desde Conversaciones llega también y se descarta por wamid.
    const msg = sent.safeParse(env.data.data);
    if (!msg.success) return [];
    const to = PHONE_JID.exec(msg.data.chatId ?? msg.data.to ?? "")?.[1];
    if (!to) return [];
    return [{
      kind: "echo",
      wamid: msg.data.id,
      to,
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
