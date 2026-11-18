/**
 * Cliente HTTP firmado de los endpoints internos de la app (`/api/internal/bot/<op>`).
 * El Worker NO escribe pedidos por SQL: cotiza, confirma, cancela y consulta por acá.
 *
 * Sin dependencias de Node ni de Next: solo `fetch` y Web Crypto. La firma es la misma que verifica
 * `src/lib/bot-internal/signature.ts`: HMAC-SHA256 de `${timestamp}.${METHOD}.${path}.${sha256hex(cuerpo)}`.
 */

export type OrderOp = "quote" | "confirm" | "cancel" | "status";

export const TIMESTAMP_HEADER = "x-bot-timestamp";
export const SIGNATURE_HEADER = "x-bot-signature";
export const NONCE_HEADER = "x-bot-nonce";
export const REQUEST_TIMEOUT_MS = 8_000;
/** Reintentos después del primer intento (solo códigos transitorios). */
export const MAX_RETRIES = 2;
const BACKOFF_MS = [250, 750] as const;

export interface SignatureParts {
  timestamp: string;
  nonce?: string | null;
  method: string;
  path: string;
  body: string;
}

const encoder = new TextEncoder();
const toHex = (buffer: ArrayBuffer): string => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function sha256Hex(text: string): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", encoder.encode(text)));
}

/** Firma hex de una llamada (idéntica a `signBotRequest` de la app). */
export async function signRequest(secret: string, parts: SignatureParts): Promise<string> {
  const head = parts.nonce ? `${parts.timestamp}.${parts.nonce}` : parts.timestamp;
  const payload = `${head}.${parts.method.toUpperCase()}.${parts.path}.${await sha256Hex(parts.body)}`;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(await crypto.subtle.sign("HMAC", key, encoder.encode(payload)));
}

export type FailureKind = "api" | "network" | "timeout" | "not_configured" | "bad_response";

export interface OrderFailure {
  ok: false;
  kind: FailureKind;
  /** Status HTTP (0 si no hubo respuesta). */
  status: number;
  /** Código estable del servidor (`out_of_zone`, `orders_disabled`...) o del cliente (`network`, `timeout`). */
  code: string;
  error: string;
}

export type OrderResponse = { ok: true; status: number; data: Record<string, unknown> } | OrderFailure;

export interface OrdersClientOptions {
  /** URL base de la app (APP_URL). */
  baseUrl: string;
  /** BOT_INTERNAL_SECRET. */
  secret: string;
  fetchImpl?: typeof fetch;
  /** Reloj en ms (inyectable para tests). */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Log sin datos personales: solo op, status y código. */
  log?: (message: string, detail?: unknown) => void;
}

export interface CommonFields {
  conversationId: string;
  inboundWamid: string;
}

export interface QuoteRequest extends CommonFields {
  items: { product_id: string; qty: number }[];
  address: string;
}

export interface ConfirmRequest extends CommonFields {
  payment_method: "Mercado Pago" | "Efectivo";
  notes?: string;
}

export interface CancelRequest extends CommonFields {
  confirmed: true;
}

export interface OrdersClient {
  quote(body: QuoteRequest): Promise<OrderResponse>;
  confirm(body: ConfirmRequest): Promise<OrderResponse>;
  cancel(body: CancelRequest): Promise<OrderResponse>;
  status(body: CommonFields): Promise<OrderResponse>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const failure = (kind: FailureKind, status: number, code: string, error: string): OrderFailure => ({ ok: false, kind, status, code, error });

async function parseJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Qué hacer con una respuesta: terminar, o reintentar (con o sin espera). */
type Verdict = { done: OrderResponse } | { retry: "transient" | "claim_lost"; last: OrderFailure };

async function judge(response: Response): Promise<Verdict> {
  const body = await parseJson(response);
  const status = response.status;
  if (response.ok) {
    return body && body.ok === true
      ? { done: { ok: true, status, data: body } }
      : { done: failure("bad_response", status, "bad_response", "Respuesta inesperada de la app.") };
  }
  const code = typeof body?.code === "string" ? body.code : `http_${status}`;
  const error = typeof body?.error === "string" ? body.error : "Error de la app.";
  if (status === 503 && code === "not_configured") return { done: failure("not_configured", status, code, error) };
  const fail = failure("api", status, code, error);
  if (status === 409 && code === "claim_lost") return { retry: "claim_lost", last: fail };
  if (status === 429 || status >= 500) return { retry: "transient", last: fail };
  return { done: fail };
}

export function createOrdersClient(options: OrdersClientOptions): OrdersClient {
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const log = options.log ?? (() => {});
  const base = options.baseUrl.replace(/\/+$/, "");

  async function attempt(path: string, rawBody: string, idempotencyKey: string | null): Promise<Verdict> {
    // Timestamp NUEVO en cada intento: la ventana del servidor es de 60 s.
    const timestamp = String(Math.floor(now() / 1000));
    // Nonce nuevo por intento: la app rechaza una llamada repetida (anti-replay) aunque caiga en el mismo segundo.
    const nonce = crypto.randomUUID();
    const signature = await signRequest(options.secret, { timestamp, nonce, method: "POST", path, body: rawBody });
    const headers: Record<string, string> = {
      "content-type": "application/json",
      [TIMESTAMP_HEADER]: timestamp,
      [SIGNATURE_HEADER]: signature,
      [NONCE_HEADER]: nonce,
    };
    if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // Workers solo acepta redirect "follow" o "manual" ("error" tira TypeError y toda llamada caía como `network`).
      // Con "manual" una redirección no se sigue: se trata como falla no reintentable.
      const response = await doFetch(`${base}${path}`, { method: "POST", headers, body: rawBody, signal: controller.signal, redirect: "manual" });
      if (response.status >= 300 && response.status < 400) {
        return { done: failure("api", response.status, "redirect", "La app respondió con una redirección inesperada.") };
      }
      return await judge(response);
    } catch (error: unknown) {
      log("[whatsapp-bot] orders fetch", { op: path, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "desconocido" });
      const aborted = controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      const last = aborted
        ? failure("timeout", 0, "timeout", "La app no respondió a tiempo.")
        : failure("network", 0, "network", "No se pudo conectar con la app.");
      return { retry: "transient", last };
    } finally {
      clearTimeout(timer);
    }
  }

  async function call(op: OrderOp, body: CommonFields, idempotent: boolean): Promise<OrderResponse> {
    const path = `/api/internal/bot/${op}`;
    const rawBody = JSON.stringify(body);
    // confirm/cancel llevan Idempotency-Key = wamid entrante y solo se reintentan con esa misma clave.
    const key = op === "confirm" || op === "cancel" ? body.inboundWamid : null;
    let transientRetries = 0;
    let claimRetried = false;
    let last: OrderResponse;

    for (;;) {
      const verdict = await attempt(path, rawBody, key);
      if ("done" in verdict) {
        last = verdict.done;
        break;
      }
      last = verdict.last;
      if (!idempotent) break;
      if (verdict.retry === "claim_lost") {
        if (claimRetried) break;
        claimRetried = true;
        await sleep(BACKOFF_MS[0]);
        continue;
      }
      if (transientRetries >= MAX_RETRIES) break;
      await sleep(BACKOFF_MS[transientRetries] ?? BACKOFF_MS[BACKOFF_MS.length - 1]);
      transientRetries += 1;
    }
    log("[whatsapp-bot] orders", last.ok ? { op, status: last.status } : { op, status: last.status, code: last.code });
    return last;
  }

  return {
    quote: (body) => call("quote", body, true),
    confirm: (body) => call("confirm", body, body.inboundWamid.length > 0),
    cancel: (body) => call("cancel", body, body.inboundWamid.length > 0),
    status: (body) => call("status", body, true),
  };
}
