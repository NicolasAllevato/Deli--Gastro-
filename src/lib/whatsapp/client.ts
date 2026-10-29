import type { MetaTemplatePayload } from "./templates.ts";

// v21.0 se da de baja el 21/01/2027; v26.0 es la vigente (julio 2026).
const GRAPH_URL = "https://graph.facebook.com/v26.0";
const REQUEST_TIMEOUT_MS = 10_000;

export interface WhatsAppCredentials {
  accessToken: string;
  phoneNumberId: string;
  /** Cuenta de WhatsApp Business: necesaria para administrar plantillas. */
  wabaId?: string;
}

export class WhatsAppApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "WhatsAppApiError";
    this.status = status;
  }
}

export interface PhoneInfo {
  display_phone_number: string;
  verified_name: string;
  quality_rating?: string;
}

export interface WabaInfo {
  id: string;
  name?: string;
}

export interface TemplateInfo {
  name: string;
  status: string;
  category: string;
  language: string;
}

export interface DownloadedMedia {
  mimeType: string;
  data: ArrayBuffer;
}

interface GraphError {
  error?: { message?: string };
}

/** Cliente mínimo de la WhatsApp Cloud API. `fetchImpl` se inyecta para poder probarlo. */
export function createWhatsAppClient(creds: WhatsAppCredentials, fetchImpl: typeof fetch = fetch) {
  const authHeaders = { Authorization: `Bearer ${creds.accessToken}` };

  async function call<T>(url: string, init: RequestInit = {}): Promise<T> {
    const res = await fetchImpl(url, {
      ...init,
      headers: { ...authHeaders, ...(init.headers as Record<string, string> | undefined) },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const json = (await res.json().catch(() => ({}))) as T & GraphError;
    if (!res.ok) throw new WhatsAppApiError(res.status, json.error?.message ?? `Error ${res.status} de WhatsApp`);
    return json;
  }

  function requireWaba(): string {
    if (!creds.wabaId) throw new WhatsAppApiError(400, "Falta el WABA ID para administrar plantillas.");
    return creds.wabaId;
  }

  async function send(to: string, message: Record<string, unknown>): Promise<string> {
    const json = await call<{ messages?: Array<{ id: string }> }>(`${GRAPH_URL}/${creds.phoneNumberId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to, ...message }),
    });
    const wamid = json.messages?.[0]?.id;
    if (!wamid) throw new WhatsAppApiError(502, "WhatsApp no devolvió el id del mensaje.");
    return wamid;
  }

  return {
    /** Texto libre: solo se entrega dentro de la ventana de 24 h del cliente. */
    sendText: (to: string, body: string) =>
      send(to, { type: "text", text: { body, preview_url: false } }),

    /** Plantilla aprobada; `bodyParams` completan {{1}}, {{2}}... del cuerpo. */
    sendTemplate: (to: string, name: string, language: string, bodyParams: readonly string[] = []) =>
      send(to, {
        type: "template",
        template: {
          name,
          language: { code: language },
          components:
            bodyParams.length > 0
              ? [{ type: "body", parameters: bodyParams.map((text) => ({ type: "text", text })) }]
              : [],
        },
      }),

    /** Plantillas de la cuenta con su estado de aprobación (APPROVED, PENDING, REJECTED...). */
    async listTemplates(): Promise<TemplateInfo[]> {
      const json = await call<{ data?: TemplateInfo[] }>(
        `${GRAPH_URL}/${requireWaba()}/message_templates?fields=name,status,category,language&limit=100`,
      );
      return (json.data ?? []).map(({ name, status, category, language }) => ({ name, status, category, language }));
    },

    /** Crea una plantilla; queda PENDING hasta que Meta la apruebe. */
    createTemplate: (payload: MetaTemplatePayload) =>
      call<{ id: string; status: string; category: string }>(`${GRAPH_URL}/${requireWaba()}/message_templates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),

    getPhoneInfo: () =>
      call<PhoneInfo>(`${GRAPH_URL}/${creds.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating`),

    /** Datos de la cuenta de WhatsApp Business: confirma que el WABA ID y el token coinciden. */
    getWabaInfo: () => call<WabaInfo>(`${GRAPH_URL}/${requireWaba()}?fields=id,name`),

    /** ¿La app recibe los eventos de la cuenta? Sin esto el webhook se verifica pero no llegan mensajes. */
    async isAppSubscribed(): Promise<boolean> {
      const json = await call<{ data?: unknown[] }>(`${GRAPH_URL}/${requireWaba()}/subscribed_apps`);
      return (json.data ?? []).length > 0;
    },

    /** Suscribe la app (la del token) a la cuenta para recibir mensajes en el webhook. */
    subscribeApp: () =>
      call<{ success?: boolean }>(`${GRAPH_URL}/${requireWaba()}/subscribed_apps`, { method: "POST" }),

    /** Registra el número en la Cloud API con el PIN de verificación en dos pasos (6 dígitos). */
    async registerPhone(pin: string): Promise<void> {
      if (!/^\d{6}$/.test(pin)) throw new WhatsAppApiError(400, "El PIN tiene que ser de 6 dígitos.");
      await call(`${GRAPH_URL}/${creds.phoneNumberId}/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messaging_product: "whatsapp", pin }),
      });
    },

    /** Descarga un archivo recibido (p. ej. un audio), rechazando los que superan `maxBytes`. */
    async downloadMedia(mediaId: string, maxBytes: number): Promise<DownloadedMedia> {
      const info = await call<{ url: string; mime_type: string; file_size?: number }>(`${GRAPH_URL}/${mediaId}`);
      if (typeof info.file_size === "number" && info.file_size > maxBytes) {
        throw new WhatsAppApiError(413, "El archivo es demasiado grande.");
      }
      const res = await fetchImpl(info.url, { headers: authHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new WhatsAppApiError(res.status, "No se pudo descargar el archivo.");
      const data = await res.arrayBuffer();
      if (data.byteLength > maxBytes) throw new WhatsAppApiError(413, "El archivo es demasiado grande.");
      return { mimeType: info.mime_type, data };
    },
  };
}

export type WhatsAppClient = ReturnType<typeof createWhatsAppClient>;

export interface CodeExchange {
  appId: string;
  appSecret: string;
  /** Código que devuelve FB.login en el flujo Embedded Signup (un solo uso, vence en minutos). */
  code: string;
}

/** Canjea el código de Embedded Signup por el token de acceso del negocio (flujo SDK JS: sin redirect_uri). */
export async function exchangeCodeForToken(
  { appId, appSecret, code }: CodeExchange,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const params = new URLSearchParams({ client_id: appId, client_secret: appSecret, code });
  const res = await fetchImpl(`${GRAPH_URL}/oauth/access_token?${params}`, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string } & GraphError;
  if (!res.ok) throw new WhatsAppApiError(res.status, json.error?.message ?? `Error ${res.status} de Meta`);
  if (!json.access_token) throw new WhatsAppApiError(502, "Meta no devolvió el token de acceso.");
  return json.access_token;
}

export interface WabaPhoneNumber {
  id: string;
  display_phone_number?: string;
}

/** Números de una WABA (para resolver el phone_number_id cuando Meta solo informa el waba_id). */
export async function listWabaPhoneNumbers(
  { accessToken, wabaId }: { accessToken: string; wabaId: string },
  fetchImpl: typeof fetch = fetch,
): Promise<WabaPhoneNumber[]> {
  const res = await fetchImpl(`${GRAPH_URL}/${wabaId}/phone_numbers?fields=id,display_phone_number&limit=25`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const json = (await res.json().catch(() => ({}))) as { data?: WabaPhoneNumber[] } & GraphError;
  if (!res.ok) throw new WhatsAppApiError(res.status, json.error?.message ?? `Error ${res.status} de Meta`);
  return (json.data ?? []).filter((n) => typeof n.id === "string");
}
