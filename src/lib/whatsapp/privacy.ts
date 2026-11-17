/**
 * Privacidad de WhatsApp: módulo puro (sin Next ni Cloudflare), lo usan la app y el Worker del bot.
 *
 * 1. `inspectPrivacy`: barrera de salida del bot, complementa `inspectOutbound` (secretos, teléfonos ajenos, links).
 *    Bloquea emails, tarjetas, CBU/CVU, DNI, ids internos completos, SQL, trazas de error y credenciales genéricas.
 * 2. `redactPii` / `maskPhone` / `safeError`: para logs. Nunca se imprime un teléfono completo, un email,
 *    un token ni el texto de un mensaje.
 */

export type PrivacyReason = "pii_leak" | "secret_leak" | "internal_leak";

export interface PrivacyInspection {
  verdict: "ok" | "block";
  reasons: PrivacyReason[];
}

export interface PrivacyContext {
  /** Emails que la respuesta puede mencionar (el del local, si está en la base de conocimiento). */
  allowedEmails?: readonly string[];
}

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;
/** 13 a 19 dígitos, con espacios o guiones entre grupos: candidato a tarjeta (se confirma con Luhn). */
const CARD_CANDIDATE = /\b\d(?:[ -]?\d){12,18}\b/g;
/** CBU y CVU tienen exactamente 22 dígitos. */
const CBU = /(?<!\d)\d{22}(?!\d)/;
const DNI = /\b(dni|documento|d\.n\.i\.?)\b\D{0,25}\d{1,2}\.?\d{3}\.?\d{3}\b/i;
const SQL = /\b(select\s+[\w*,\s]+\s+from\s+\w|insert\s+into\s+\w|update\s+\w+\s+set\s|delete\s+from\s+\w|create\s+table\s|drop\s+table\s)/i;
const STACK = /\bat\s+[\w$.<>]+\s+\([^)]*:\d+:\d+\)|\b(TypeError|ReferenceError|SyntaxError|SQLITE_\w+|D1_ERROR)\b/;
const CREDENTIAL = /\b(api[_-]?key|access[_-]?token|secret|password|contraseña|bearer)\b\s*[:=]?\s*[A-Za-z0-9_\-.]{16,}/i;

/** Algoritmo de Luhn: distingue un número de tarjeta de un número cualquiera. */
export function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return digits.length >= 13 && sum % 10 === 0;
}

function hasCard(text: string): boolean {
  return (text.match(CARD_CANDIDATE) ?? []).some((m) => passesLuhn(m.replace(/\D/g, "")));
}

function foreignEmail(text: string, allowed: readonly string[]): boolean {
  const ok = new Set(allowed.map((e) => e.trim().toLowerCase()));
  return (text.match(EMAIL) ?? []).some((e) => !ok.has(e.toLowerCase()));
}

/** Respuesta del bot antes de mandarla: `block` = no se envía (se reemplaza por un mensaje seguro). */
export function inspectPrivacy(raw: string, ctx: PrivacyContext = {}): PrivacyInspection {
  // Los links ya los controla `inspectOutbound` (dominios permitidos); el link de pago lleva ids que no son una filtración.
  const text = raw.replace(/https?:\/\/\S+/gi, " ");
  const reasons = new Set<PrivacyReason>();
  if (foreignEmail(text, ctx.allowedEmails ?? []) || hasCard(text) || CBU.test(text) || DNI.test(text)) reasons.add("pii_leak");
  if (CREDENTIAL.test(text)) reasons.add("secret_leak");
  if (UUID.test(text) || SQL.test(text) || STACK.test(text)) reasons.add("internal_leak");
  return { verdict: reasons.size > 0 ? "block" : "ok", reasons: [...reasons] };
}

/** Combina dos inspecciones de salida: alcanza con que una bloquee. */
export function mergeInspections<A extends string, B extends string>(
  a: { verdict: string; reasons: A[] },
  b: { verdict: string; reasons: B[] },
): { verdict: "ok" | "suspicious" | "block"; reasons: (A | B)[] } {
  const verdict = a.verdict === "block" || b.verdict === "block" ? "block" : a.verdict === "suspicious" ? "suspicious" : "ok";
  return { verdict, reasons: [...a.reasons, ...b.reasons] };
}

/** Teléfono para logs: solo los últimos 4 dígitos. */
export function maskPhone(phone: string | null | undefined): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length === 0 ? "***" : `***${digits.slice(-4)}`;
}

const TOKENS: readonly RegExp[] = [
  /\bEAA[A-Za-z0-9]{20,}/g,
  /\b(APP_USR|TEST)-[\w-]{20,}/g,
  /\bsk-[A-Za-z0-9-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g,
  /\bBearer\s+[A-Za-z0-9._-]{10,}/gi,
  /\bpostgres(ql)?:\/\/\S+/gi,
];

/** Texto apto para logs: sin tokens, emails ni teléfonos completos (los ids y códigos cortos se dejan). */
export function redactPii(text: string): string {
  let out = text;
  for (const re of TOKENS) out = out.replace(re, "[token]");
  out = out.replace(EMAIL, "[email]");
  // Secuencias de 8+ dígitos (con separadores típicos de teléfono): se dejan los últimos 4.
  out = out.replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => (m.replace(/\D/g, "").length >= 8 ? maskPhone(m) : m));
  return out;
}

export interface MaskContext {
  /** Nombres propios conocidos del cliente (perfil de WhatsApp, ficha de cliente). */
  names?: readonly (string | null | undefined)[];
  /** Direcciones conocidas del cliente (ficha, pedidos): se reemplazan literalmente. */
  addresses?: readonly (string | null | undefined)[];
}

const STREET_CUE = /\b(?:av(?:enida)?|calle|pasaje|pje|bv|boulevard|bulevar|diagonal|diag|ruta|camino)\.?\s+(?:[\p{L}.'°º]+\s+){0,4}\d{1,5}\b(?:\s*(?:piso|p|dpto|depto|dto|torre|lote|casa)\.?\s*\w{1,4})*/giu;
const ADDRESS_CUE = /\b(direcci[oó]n|domicilio|vivo en|estoy en|mand[aá](?:lo|melo)? a|envi[aá](?:lo|melo)? a|traelo a|entregar en|entre calles)\b\s*:?\s*[^\n.!?]{3,80}/giu;
const CAPITALIZED_ADDRESS = /\b(?:\p{Lu}[\p{L}.]+\s+){1,4}\d{3,5}\b/gu;
const NAME_CUE = /\b(me llamo|mi nombre es|soy)\s+(\p{Lu}[\p{L}]+(?:\s+\p{Lu}[\p{L}]+)?)/gu;
const DNI_NUMBER = /\b(dni|documento|d\.n\.i\.?)\b\D{0,25}\d{1,2}\.?\d{3}\.?\d{3}\b/giu;

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Enmascara una transcripción ANTES de mandarla a un modelo externo: emails, tarjetas, CBU/CVU, DNI, teléfonos,
 * direcciones y nombres propios del cliente. Prefiere enmascarar de más (un número de calle) a filtrar un dato.
 */
export function maskTranscriptPii(raw: string, ctx: MaskContext = {}): string {
  let out = raw.replace(EMAIL, "[email]");
  out = out.replace(CARD_CANDIDATE, (m) => (passesLuhn(m.replace(/\D/g, "")) ? "[tarjeta]" : m));
  out = out.replace(/(?<!\d)\d{22}(?!\d)/g, "[cbu]");
  out = out.replace(DNI_NUMBER, "[dni]");
  for (const a of ctx.addresses ?? []) {
    const t = a?.trim();
    if (t && t.length >= 5) out = out.replace(new RegExp(escapeRe(t), "giu"), "[direccion]");
  }
  out = out.replace(STREET_CUE, "[direccion]");
  out = out.replace(ADDRESS_CUE, (_m, cue: string) => `${cue} [direccion]`);
  out = out.replace(CAPITALIZED_ADDRESS, "[direccion]");
  out = out.replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[telefono]" : m));
  out = out.replace(NAME_CUE, (_m, cue: string) => `${cue} [nombre]`);
  const parts = new Set<string>();
  for (const n of ctx.names ?? []) {
    for (const p of (n ?? "").split(/\s+/)) if (p.replace(/[^\p{L}]/gu, "").length >= 3) parts.add(p.replace(/[^\p{L}'-]/gu, ""));
  }
  for (const p of parts) {
    const pattern = [...fold(p)].map((c) => (/[a-z]/i.test(c) ? `${escapeRe(c)}[\\u0300-\\u036f]?` : escapeRe(c))).join("");
    // Sin importar acentos ("Martin" también tapa "Martín"): se compara en NFD y se vuelve a NFC.
    out = out.normalize("NFD").replace(new RegExp(`(?<![\\p{L}\\u0300-\\u036f])${pattern}(?![\\p{L}])`, "giu"), "[nombre]").normalize("NFC");
  }
  return out;
}

/** Mensaje de error apto para logs (sin el objeto entero, que puede traer el cuerpo de la respuesta de Meta). */
export function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "error desconocido";
  return redactPii(raw).slice(0, 300);
}

/** Detalle de log redactado en profundidad (strings, arrays y objetos planos). */
export function redactDetail(detail: unknown, depth = 0): unknown {
  if (depth > 4) return "[...]";
  if (typeof detail === "string") return redactPii(detail);
  if (detail instanceof Error) return safeError(detail);
  if (Array.isArray(detail)) return detail.map((d) => redactDetail(d, depth + 1));
  if (detail && typeof detail === "object") {
    return Object.fromEntries(Object.entries(detail).map(([k, v]) => [k, redactDetail(v, depth + 1)]));
  }
  return detail;
}

/** Logger que redacta todo lo que imprime. */
export function redactingLog(sink: (message: string, detail?: unknown) => void) {
  return (message: string, detail?: unknown): void => {
    if (detail === undefined) sink(redactPii(message));
    else sink(redactPii(message), redactDetail(detail));
  };
}
