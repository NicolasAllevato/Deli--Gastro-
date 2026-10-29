import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Firma de las llamadas internas del Worker del bot a la app.
 *
 * Mensaje firmado: `${timestamp}.${METHOD}.${path}.${sha256hex(body)}` con HMAC-SHA256 y el
 * secreto compartido `BOT_INTERNAL_SECRET`. El timestamp va en segundos Unix. Módulo puro: sin
 * Next ni base, para poder reutilizarlo del lado del Worker.
 */

export const BOT_TIMESTAMP_HEADER = "x-bot-timestamp";
export const BOT_SIGNATURE_HEADER = "x-bot-signature";
/** Ventana de validez de una firma, hacia el pasado y hacia el futuro. */
export const SIGNATURE_WINDOW_SECONDS = 60;
/** Cuerpo máximo aceptado. Un pedido de 30 líneas pesa menos de 4 KB. */
export const MAX_BODY_BYTES = 16 * 1024;

export type SignatureFailure = "missing_headers" | "bad_timestamp" | "stale" | "future" | "bad_signature";

export type SignatureCheck = { ok: true } | { ok: false; reason: SignatureFailure };

export interface SignatureParts {
  timestamp: string;
  method: string;
  path: string;
  body: string;
}

const sha256Hex = (body: string): string => createHash("sha256").update(body, "utf8").digest("hex");

export function signaturePayload({ timestamp, method, path, body }: SignatureParts): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${sha256Hex(body)}`;
}

/** Firma hex de una llamada (la usa el Worker; acá, los tests). */
export function signBotRequest(secret: string, parts: SignatureParts): string {
  return createHmac("sha256", secret).update(signaturePayload(parts)).digest("hex");
}

export interface VerifyInput {
  /** Secretos válidos: el vigente y, durante una rotación, el anterior. Los vacíos se ignoran. */
  secrets: readonly string[];
  method: string;
  path: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  /** Reloj en milisegundos (inyectable para tests). */
  nowMs: number;
}

/** Compara en tiempo constante; el largo se revisa antes porque `timingSafeEqual` lo exige. */
function sameHex(expectedHex: string, receivedHex: string): boolean {
  if (!/^[0-9a-f]+$/i.test(receivedHex)) return false;
  const expected = Buffer.from(expectedHex, "hex");
  const received = Buffer.from(receivedHex, "hex");
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function verifyBotRequest(input: VerifyInput): SignatureCheck {
  const { timestamp, signature } = input;
  if (!timestamp || !signature) return { ok: false, reason: "missing_headers" };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: "bad_timestamp" };

  const skew = input.nowMs / 1000 - Number(timestamp);
  if (skew > SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "stale" };
  if (skew < -SIGNATURE_WINDOW_SECONDS) return { ok: false, reason: "future" };

  const parts: SignatureParts = { timestamp, method: input.method, path: input.path, body: input.body };
  // Se prueban todos los secretos sin cortar antes: el tiempo no revela cuál coincidió.
  let match = false;
  for (const secret of input.secrets) {
    if (!secret) continue;
    if (sameHex(signBotRequest(secret, parts), signature)) match = true;
  }
  return match ? { ok: true } : { ok: false, reason: "bad_signature" };
}
