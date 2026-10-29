import { z } from "zod";

const ID_PATTERN = /^\d{5,32}$/;
const idField = (message: string) => z.string().regex(ID_PATTERN, message);
const codeField = z.string().trim().min(1, "Falta el código de Meta.").max(2048);

/**
 * Cuerpo que el navegador manda al servidor al terminar el alta con Facebook.
 * - `standard`: número nuevo en la Cloud API; Meta informa phone_number_id y waba_id y se registra con PIN.
 * - `coexistence`: número que sigue en la app WhatsApp Business; ya está registrado, así que no hay PIN y
 *   el evento de Meta solo trae el waba_id (el phone_number_id es opcional: si falta lo resuelve el servidor).
 */
export const signupBodySchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("standard"),
      code: codeField,
      phoneNumberId: idField("El Phone Number ID no es válido."),
      wabaId: idField("El WABA ID no es válido."),
      pin: z.string().regex(/^\d{6}$/, "El PIN tiene que ser de 6 dígitos."),
    })
    .strict(),
  z
    .object({
      mode: z.literal("coexistence"),
      code: codeField,
      wabaId: idField("El WABA ID no es válido."),
      phoneNumberId: idField("El Phone Number ID no es válido.").optional(),
    })
    .strict(),
]);

export type SignupBody = z.infer<typeof signupBodySchema>;

export type SignupMessage =
  | { kind: "finish"; phoneNumberId: string; wabaId: string }
  | { kind: "finish_coexistence"; wabaId: string }
  | { kind: "cancel"; step: string | null };

/** Versión de Embedded Signup que pedimos a Meta (v2 y v3 quedaron deprecadas el 15-oct-2026). */
export const SIGNUP_VERSION = "v5";

export interface SignupExtras {
  version: typeof SIGNUP_VERSION;
  features?: Array<{ name: string; enabled: boolean }>;
}

/**
 * `extras` de FB.login para v5. `featureType` y `sessionInfoVersion` ya no se mandan.
 * En v5 el onboarding de la app WhatsApp Business (coexistencia) viene activado: sin coexistencia se apaga
 * explícitamente con `features`. Forma tomada de la página de versiones de Meta (verificar si cambia).
 */
export function buildSignupExtras(coexistence: boolean): SignupExtras {
  if (coexistence) return { version: SIGNUP_VERSION };
  return { version: SIGNUP_VERSION, features: [{ name: "whatsapp_business_app_onboarding", enabled: false }] };
}

/** Solo se confía en mensajes que vienen de facebook.com (o un subdominio exacto). */
function isFacebookOrigin(origin: string): boolean {
  try {
    const { protocol, hostname } = new URL(origin);
    return protocol === "https:" && (hostname === "facebook.com" || hostname.endsWith(".facebook.com"));
  } catch {
    return false;
  }
}

/**
 * Interpreta el `postMessage` que manda Embedded Signup. Devuelve `null` si el origen no es de Meta,
 * el contenido no es el esperado o los ids no son numéricos.
 */
export function parseSignupMessage(event: { origin: string; data: unknown }): SignupMessage | null {
  if (!isFacebookOrigin(event.origin) || typeof event.data !== "string") return null;

  let payload: unknown;
  try {
    payload = JSON.parse(event.data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null) return null;

  const { type, event: name, data } = payload as { type?: unknown; event?: unknown; data?: unknown };
  if (type !== "WA_EMBEDDED_SIGNUP") return null;
  const info = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const wabaId = typeof info.waba_id === "string" && ID_PATTERN.test(info.waba_id) ? info.waba_id : null;

  if (name === "CANCEL") {
    return { kind: "cancel", step: typeof info.current_step === "string" ? info.current_step : null };
  }
  if (name === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") {
    // Coexistencia: el número ya está registrado; el evento solo trae el waba_id (según la doc de Meta).
    return wabaId ? { kind: "finish_coexistence", wabaId } : null;
  }
  if (name === "FINISH" || name === "FINISH_ONLY_WABA") {
    const phoneNumberId = info.phone_number_id;
    if (wabaId && typeof phoneNumberId === "string" && ID_PATTERN.test(phoneNumberId)) {
      return { kind: "finish", phoneNumberId, wabaId };
    }
  }
  return null;
}
