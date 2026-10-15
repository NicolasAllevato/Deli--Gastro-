/**
 * Consentimiento de cookies: lógica pura (sin DOM), compartida por el banner, la página
 * /cookies y el servidor. Las cookies esenciales (sesión) no dependen de esto.
 */
export interface Consent {
  /** Recordar preferencias (tema claro/oscuro). */
  preferences: boolean;
  /** Medición de uso. Hoy no hay herramienta activa; el permiso queda registrado. */
  analytics: boolean;
  version: number;
  decidedAt: string;
}

export const CONSENT_COOKIE = "opsyn_consent";
/** Subir este número invalida las elecciones anteriores (por ejemplo, al sumar una categoría). */
export const CONSENT_VERSION = 1;
export const CONSENT_MAX_AGE_S = 60 * 60 * 24 * 180;

export const acceptAll = (now: Date = new Date()): Consent => ({
  preferences: true,
  analytics: true,
  version: CONSENT_VERSION,
  decidedAt: now.toISOString(),
});

export const essentialOnly = (now: Date = new Date()): Consent => ({
  preferences: false,
  analytics: false,
  version: CONSENT_VERSION,
  decidedAt: now.toISOString(),
});

/** Lee el valor de la cookie. Cualquier cosa inválida o de otra versión cuenta como "sin decidir". */
export function parseConsent(raw: string): Consent | null {
  try {
    const data: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
    const c = data as Record<string, unknown>;
    if (typeof c.preferences !== "boolean" || typeof c.analytics !== "boolean") return null;
    if (c.version !== CONSENT_VERSION || typeof c.decidedAt !== "string") return null;
    return { preferences: c.preferences, analytics: c.analytics, version: c.version, decidedAt: c.decidedAt };
  } catch {
    return null;
  }
}

export function readConsentFromCookieHeader(header: string): Consent | null {
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CONSENT_COOKIE) return parseConsent(rest.join("="));
  }
  return null;
}

export function serializeConsentCookie(consent: Consent): string {
  const value = encodeURIComponent(JSON.stringify(consent));
  return `${CONSENT_COOKIE}=${value}; Max-Age=${CONSENT_MAX_AGE_S}; Path=/; SameSite=Lax`;
}
