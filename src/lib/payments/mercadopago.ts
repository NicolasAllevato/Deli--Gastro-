import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Piezas puras de la integración con Mercado Pago (Checkout Pro): firma del webhook, estados,
 * validación de montos y armado de la preferencia. No hacen red ni leen la base: se prueban solas.
 *
 * Las reglas salen de la documentación de Mercado Pago y de la referencia de PagoKit (MIT):
 * se verifica la firma con el secreto del webhook (no con el access token), se rechaza un
 * timestamp viejo (anti-replay) y jamás se confía en el cuerpo del aviso: el pago se vuelve
 * a pedir a la API y se compara contra lo que el servidor cotizó.
 */

export const MP_CURRENCY = "ARS";
/** Ventana en la que un aviso firmado se considera fresco. */
export const SIGNATURE_TOLERANCE_SECONDS = 300;
/** Minutos que el cliente tiene para pagar antes de que la intención venza. */
export const PAYMENT_WINDOW_MINUTES = 30;

export interface ParsedSignature {
  ts: string;
  v1: string;
}

/** `x-signature: ts=1704908010,v1=abc…` → partes. null si falta alguna. */
export function parseSignatureHeader(header: string | null | undefined): ParsedSignature | null {
  if (!header) return null;
  const parts = new Map<string, string>();
  for (const chunk of header.split(",")) {
    const index = chunk.indexOf("=");
    if (index > 0) parts.set(chunk.slice(0, index).trim(), chunk.slice(index + 1).trim());
  }
  const ts = parts.get("ts");
  const v1 = parts.get("v1");
  return ts && v1 ? { ts, v1 } : null;
}

/** Mercado Pago pide el id en minúsculas cuando es alfanumérico. */
const normalizeDataId = (dataId: string): string => (/^[a-z0-9]+$/i.test(dataId) ? dataId.toLowerCase() : dataId);

export function buildManifest(input: { dataId: string; requestId: string; ts: string }): string {
  return `id:${normalizeDataId(input.dataId)};request-id:${input.requestId};ts:${input.ts};`;
}

export function signManifest(secret: string, manifest: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

export type SignatureCheck = { ok: true } | { ok: false; reason: "missing" | "stale" | "mismatch" };

export function verifyWebhookSignature(input: {
  signatureHeader: string | null | undefined;
  requestId: string | null | undefined;
  dataId: string | null | undefined;
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}): SignatureCheck {
  const parsed = parseSignatureHeader(input.signatureHeader);
  if (!parsed || !input.requestId || !input.dataId || !input.secret) return { ok: false, reason: "missing" };

  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  const ts = Number(parsed.ts);
  // El timestamp de Mercado Pago puede venir en milisegundos: se normaliza a segundos.
  const seconds = ts > 1e12 ? Math.floor(ts / 1000) : ts;
  if (!Number.isFinite(seconds) || Math.abs(now - seconds) > tolerance) return { ok: false, reason: "stale" };

  const expected = Buffer.from(signManifest(input.secret, buildManifest({ dataId: input.dataId, requestId: input.requestId, ts: parsed.ts })));
  const received = Buffer.from(parsed.v1);
  const same = expected.length === received.length && timingSafeEqual(expected, received);
  return same ? { ok: true } : { ok: false, reason: "mismatch" };
}

export type PaymentOutcome = "approved" | "pending" | "rejected" | "reversed";

/** Estados de Mercado Pago reducidos a los cuatro que le importan al local. */
export function classifyPaymentStatus(status: string | null | undefined): PaymentOutcome {
  switch (status) {
    case "approved":
      return "approved";
    case "rejected":
    case "cancelled":
      return "rejected";
    case "refunded":
    case "charged_back":
      return "reversed";
    default:
      return "pending"; // pending, in_process, in_mediation, authorized, desconocidos
  }
}

export interface MpPayment {
  id: number | string;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string | null;
}

/** El pago que informa Mercado Pago tiene que ser exactamente el que se cotizó. */
export function paymentMatchesIntent(
  payment: Pick<MpPayment, "transaction_amount" | "currency_id" | "external_reference">,
  intent: { id: string; total: number },
): boolean {
  return (
    payment.external_reference === intent.id &&
    payment.currency_id === MP_CURRENCY &&
    Math.abs(Number(payment.transaction_amount) - intent.total) < 0.005
  );
}

export interface PreferenceInput {
  intentId: string;
  title: string;
  total: number;
  payerEmail?: string | null;
  baseUrl: string;
  notificationUrl: string;
  expiresAt: Date;
}

/** Una sola línea por el total del pedido (con envío y canje ya aplicados): el monto lo fija el servidor. */
export function buildPreference(input: PreferenceInput) {
  const back = `${input.baseUrl.replace(/\/$/, "")}/cliente/pago/${input.intentId}`;
  return {
    items: [{ id: input.intentId, title: input.title.slice(0, 120), quantity: 1, unit_price: Number(input.total.toFixed(2)), currency_id: MP_CURRENCY }],
    ...(input.payerEmail ? { payer: { email: input.payerEmail } } : {}),
    back_urls: { success: back, failure: back, pending: back },
    auto_return: "approved" as const,
    notification_url: input.notificationUrl,
    external_reference: input.intentId,
    expires: true,
    expiration_date_to: input.expiresAt.toISOString(),
  };
}

export const isTestToken = (token: string): boolean => token.startsWith("TEST-");
