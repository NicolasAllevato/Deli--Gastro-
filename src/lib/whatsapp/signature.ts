import { createHmac, timingSafeEqual } from "node:crypto";

const PREFIX = "sha256=";

/**
 * Valida el encabezado `X-Hub-Signature-256` de Meta: HMAC-SHA256 del cuerpo crudo
 * con el App Secret. Sin secreto configurado se rechaza todo (falla cerrado).
 */
export function verifySignature(rawBody: string, header: string | null, appSecret: string): boolean {
  if (!appSecret || !header || !header.startsWith(PREFIX)) return false;

  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const received = Buffer.from(header.slice(PREFIX.length), "hex");
  // timingSafeEqual exige la misma longitud; una firma truncada o con basura no es válida.
  return received.length === expected.length && timingSafeEqual(received, expected);
}
