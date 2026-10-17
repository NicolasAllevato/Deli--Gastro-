import { z } from "zod";

/**
 * Resumen diario por mail y WhatsApp. La configuración (quién lo recibe y a qué hora) la edita el admin
 * en `global_config.resumen_diario`; el último envío lo escribe solo el servidor en
 * `global_config.resumen_diario_ultimo`, así una edición del panel no puede pisarlo ni repetir el envío.
 */
export const DAILY_SUMMARY_KEY = "resumen_diario";
export const DAILY_SUMMARY_LAST_KEY = "resumen_diario_ultimo";
export const MAX_RECIPIENTS = 20;

const HOUR = /^([01]\d|2[0-3]):[0-5]\d$/;

export const recipientSchema = z
  .object({
    id: z.string().trim().min(1).max(40),
    nombre: z.string().trim().min(1, "Poné el nombre de cada destinatario").max(60),
    email: z.union([z.email("Mail inválido"), z.literal("")]),
    /** Con código de país y sin signos, como lo usa WhatsApp (ej. 5491155550101). */
    telefono: z.string().trim().regex(/^(\d{8,15})?$/, "El teléfono va solo con números y código de país"),
    activo: z.boolean(),
  })
  .refine((r) => r.email !== "" || r.telefono !== "", {
    message: "Cada destinatario necesita un mail o un teléfono",
  });

export const dailySummarySettingsSchema = z.object({
  activo: z.boolean(),
  /** Hora de cierre (Buenos Aires) a partir de la cual se envía el resumen del día. */
  hora: z.string().regex(HOUR, "Horario inválido (HH:MM)"),
  destinatarios: z.array(recipientSchema).max(MAX_RECIPIENTS, `Hasta ${MAX_RECIPIENTS} destinatarios`),
});

export type DailySummarySettings = z.infer<typeof dailySummarySettingsSchema>;
export type Recipient = z.infer<typeof recipientSchema>;

export const DEFAULT_SETTINGS: DailySummarySettings = { activo: false, hora: "23:30", destinatarios: [] };

/** Lee lo guardado descartando destinatarios inválidos; sin nada válido devuelve los valores por defecto. */
export function parseSettings(raw: unknown): DailySummarySettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const value = raw as Record<string, unknown>;
  const recipients = Array.isArray(value.destinatarios)
    ? value.destinatarios.flatMap((item) => {
        const parsed = recipientSchema.safeParse(item);
        return parsed.success ? [parsed.data] : [];
      })
    : [];
  return {
    activo: value.activo === true,
    hora: typeof value.hora === "string" && HOUR.test(value.hora) ? value.hora : DEFAULT_SETTINGS.hora,
    destinatarios: recipients.slice(0, MAX_RECIPIENTS),
  };
}

export interface LastSend {
  fecha: string;
  email: number;
  whatsapp: number;
  errores: number;
}

export function parseLastSend(raw: unknown): LastSend | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (typeof v.fecha !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.fecha)) return null;
  const n = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : 0);
  return { fecha: v.fecha, email: n(v.email), whatsapp: n(v.whatsapp), errores: n(v.errores) };
}

/** Argentina está en UTC-3 todo el año. */
const OFFSET_MS = 3 * 60 * 60 * 1000;

/** Fecha (YYYY-MM-DD) y minutos desde medianoche, en hora de Buenos Aires. */
export function localClock(now: Date): { date: string; minutes: number } {
  const local = new Date(now.getTime() - OFFSET_MS);
  return {
    date: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}

export const hasContact = (r: Recipient) => r.activo && (r.email !== "" || r.telefono !== "");

/** ¿Hay que enviar el resumen ahora? Una sola vez por día, pasada la hora de cierre. */
export function isDue(settings: DailySummarySettings, last: LastSend | null, now: Date): boolean {
  if (!settings.activo || !settings.destinatarios.some(hasContact)) return false;
  const clock = localClock(now);
  if (last?.fecha === clock.date) return false;
  const [h, m] = settings.hora.split(":").map(Number);
  return clock.minutes >= (h ?? 0) * 60 + (m ?? 0);
}
