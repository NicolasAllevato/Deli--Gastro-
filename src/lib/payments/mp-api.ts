import { isTestToken, type MpPayment } from "./mercadopago.ts";

/**
 * Cliente mínimo de la API de Mercado Pago (Checkout Pro). Solo lo que el local necesita:
 * crear la preferencia, consultar pagos y reembolsar. `fetch` se inyecta para probarlo sin red.
 * Nunca se loguea el access token ni el cuerpo de las respuestas (traen datos del pagador).
 */

const API_BASE = "https://api.mercadopago.com";
const TIMEOUT_MS = 8_000;

export interface MpConfig {
  accessToken: string;
  webhookSecret: string;
  /** URL pública de la app (https): de acá salen las back_urls y la notification_url. */
  baseUrl: string;
}

type Env = Record<string, string | undefined>;

/** Configuración completa o null: sin las tres variables el cobro no se ofrece. */
export function readMpConfig(env: Env = process.env): MpConfig | null {
  const accessToken = env.MP_ACCESS_TOKEN?.trim();
  const webhookSecret = env.MP_WEBHOOK_SECRET?.trim();
  const baseUrl = env.PUBLIC_URL?.trim();
  return accessToken && webhookSecret && baseUrl ? { accessToken, webhookSecret, baseUrl } : null;
}

export class MpApiError extends Error {
  readonly status: number;
  readonly operation: string;

  constructor(status: number, operation: string) {
    super(`Mercado Pago respondió ${status} en ${operation}`);
    this.name = "MpApiError";
    this.status = status;
    this.operation = operation;
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function call<T>(
  cfg: MpConfig,
  operation: string,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  fetchImpl: FetchLike = fetch,
): Promise<T> {
  const res = await fetchImpl(`${API_BASE}${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      "Content-Type": "application/json",
      ...(init.idempotencyKey ? { "X-Idempotency-Key": init.idempotencyKey } : {}),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new MpApiError(res.status, operation);
  return (await res.json()) as T;
}

export interface CreatedPreference {
  id: string;
  init_point: string;
  sandbox_init_point?: string;
}

export function createPreference(cfg: MpConfig, body: unknown, idempotencyKey: string, fetchImpl?: FetchLike) {
  return call<CreatedPreference>(cfg, "crear preferencia", "/checkout/preferences", { method: "POST", body, idempotencyKey }, fetchImpl);
}

export function getPayment(cfg: MpConfig, paymentId: string | number, fetchImpl?: FetchLike) {
  return call<MpPayment>(cfg, "consultar pago", `/v1/payments/${encodeURIComponent(String(paymentId))}`, {}, fetchImpl);
}

export async function searchPaymentsByReference(cfg: MpConfig, reference: string, fetchImpl?: FetchLike): Promise<MpPayment[]> {
  const query = `external_reference=${encodeURIComponent(reference)}&sort=date_created&criteria=desc&limit=10`;
  const found = await call<{ results?: MpPayment[] }>(cfg, "buscar pagos", `/v1/payments/search?${query}`, {}, fetchImpl);
  return found.results ?? [];
}

/** Reembolso total (sin `amount`). La clave de idempotencia evita devolver dos veces ante un reintento. */
export function refundPayment(cfg: MpConfig, paymentId: string | number, idempotencyKey: string, fetchImpl?: FetchLike) {
  return call<{ id: number }>(
    cfg,
    "reembolsar pago",
    `/v1/payments/${encodeURIComponent(String(paymentId))}/refunds`,
    { method: "POST", body: {}, idempotencyKey },
    fetchImpl,
  );
}

/** Con credenciales de prueba se abre el checkout de sandbox; con las reales, el de producción. */
export function checkoutUrl(cfg: MpConfig, preference: CreatedPreference): string {
  return isTestToken(cfg.accessToken) && preference.sandbox_init_point ? preference.sandbox_init_point : preference.init_point;
}
