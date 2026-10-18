import { z } from "zod";

/** Cuerpo que el navegador manda al servidor al terminar el alta con Facebook. */
export const signupBodySchema = z
  .object({
    code: z.string().trim().min(1, "Falta el código de Meta.").max(2048),
    phoneNumberId: z.string().regex(/^\d{5,32}$/, "El Phone Number ID no es válido."),
    wabaId: z.string().regex(/^\d{5,32}$/, "El WABA ID no es válido."),
    pin: z.string().regex(/^\d{6}$/, "El PIN tiene que ser de 6 dígitos."),
  })
  .strict();

export type SignupBody = z.infer<typeof signupBodySchema>;

export type SignupMessage =
  | { kind: "finish"; phoneNumberId: string; wabaId: string }
  | { kind: "cancel"; step: string | null };

const ID = /^\d{5,32}$/;

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

  if (name === "CANCEL") {
    return { kind: "cancel", step: typeof info.current_step === "string" ? info.current_step : null };
  }
  if (name === "FINISH" || name === "FINISH_ONLY_WABA") {
    const phoneNumberId = info.phone_number_id;
    const wabaId = info.waba_id;
    if (typeof phoneNumberId === "string" && typeof wabaId === "string" && ID.test(phoneNumberId) && ID.test(wabaId)) {
      return { kind: "finish", phoneNumberId, wabaId };
    }
  }
  return null;
}
