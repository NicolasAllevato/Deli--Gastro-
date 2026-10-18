/** Comparación en tiempo constante (no corta en el primer carácter distinto). */
export function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Verificación inicial del webhook de Meta: devuelve el desafío a responder, o null si no corresponde.
 * Sin token configurado siempre rechaza.
 */
export function verifyChallenge(params: URLSearchParams, verifyToken: string | null): string | null {
  if (!verifyToken) return null;
  if (params.get("hub.mode") !== "subscribe") return null;
  if (!sameText(params.get("hub.verify_token") ?? "", verifyToken)) return null;
  return params.get("hub.challenge") ?? "";
}
