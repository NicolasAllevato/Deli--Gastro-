import { timingSafeEqual } from "node:crypto";

/**
 * ¿El encabezado `Authorization` trae `Bearer <secreto>`? Sin secreto configurado se rechaza
 * todo (falla cerrado). La comparación es de tiempo constante.
 */
export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const received = Buffer.from(header ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return received.length === expected.length && timingSafeEqual(received, expected);
}
