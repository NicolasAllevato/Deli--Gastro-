import { z } from "zod";

/**
 * Quién conectó el número de WhatsApp. Dos capas:
 * 1. `admin*`: el usuario del panel que cerró el alta (lo verifica el servidor con la sesión).
 * 2. `facebook`: nombre y email de la cuenta de Facebook que se logueó en Embedded Signup. Los informa el
 *    navegador (`FB.api('/me')`), por eso es opcional y se trata como dato declarado, no verificado.
 * Todo se guarda en UNA sola fila JSON de `integration_secrets`: se escribe de forma atómica, así nunca
 * quedan mezclados datos de dos conexiones distintas. Este módulo es puro (sin base ni alias de rutas).
 */

export const CONNECTED_BY_KEY = "whatsapp_connected_by";

const FACEBOOK_ID = /^\d{5,32}$/;

/** Perfil de Facebook que informa el navegador. Estricto: no se guarda nada fuera de estos campos. */
export const facebookProfileSchema = z.strictObject({
  id: z.string().regex(FACEBOOK_ID, "El id de Facebook no es válido."),
  name: z.string().trim().min(1, "Falta el nombre de Facebook.").max(200),
  email: z.email().max(254).optional(),
});

export type FacebookProfile = z.infer<typeof facebookProfileSchema>;

export interface ConnectedByAdmin {
  id: string;
  email?: string | null;
}

/** Lo que se guarda (serializado) en `integration_secrets`. */
const connectedBySchema = z.object({
  adminId: z.string().min(1),
  adminEmail: z.string().optional(),
  connectedAt: z.string().min(1),
  facebook: facebookProfileSchema.optional(),
});

export type ConnectedBy = z.infer<typeof connectedBySchema>;

/**
 * Perfil válido, o `undefined` si falta o no cuadra: la capa de Facebook nunca debe frenar la conexión.
 * Si lo único inválido es el email, se conserva el resto (el nombre sigue siendo útil).
 */
export function parseConnectedBy(raw: unknown): FacebookProfile | undefined {
  const full = facebookProfileSchema.safeParse(raw);
  if (full.success) return full.data;
  if (typeof raw !== "object" || raw === null || !("email" in raw)) return undefined;
  const rest = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "email"));
  const withoutEmail = facebookProfileSchema.safeParse(rest);
  return withoutEmail.success ? withoutEmail.data : undefined;
}

export function buildConnectedBy(input: { admin: ConnectedByAdmin; now: Date; facebook?: FacebookProfile }): ConnectedBy {
  const { admin, now, facebook } = input;
  return {
    adminId: admin.id,
    ...(admin.email ? { adminEmail: admin.email } : {}),
    connectedAt: now.toISOString(),
    ...(facebook ? { facebook } : {}),
  };
}

export function serializeConnectedBy(by: ConnectedBy): string {
  return JSON.stringify(by);
}

/** Lo que el panel muestra en «Conectado por…». */
export interface ConnectedBySummary {
  adminEmail: string | null;
  facebookName: string | null;
  facebookEmail: string | null;
  connectedAt: string | null;
}

/** Resumen para el panel. Ausente, vacío o corrupto = `null` (el panel muestra «sin registro»). */
export function summarizeConnectedBy(stored: string | null | undefined): ConnectedBySummary | null {
  if (!stored) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return null;
  }
  const parsed = connectedBySchema.safeParse(raw);
  if (!parsed.success) return null;
  const { adminEmail, connectedAt, facebook } = parsed.data;
  return {
    adminEmail: adminEmail ?? null,
    facebookName: facebook?.name ?? null,
    facebookEmail: facebook?.email ?? null,
    connectedAt,
  };
}
