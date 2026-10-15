import { z } from "zod";

/**
 * Sugerencias y promociones del día. Se guardan en `global_config.promos_del_dia` y las
 * edita el admin en Configuración. Son informativas: destacan un producto, pero el precio
 * siempre lo calcula el servidor (no hay "precio promo" que pueda diferir del cobrado).
 */
export const PROMO_CONFIG_KEY = "promos_del_dia";
export const MAX_PROMOS = 20;

export const DIAS_SEMANA = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"] as const;

export const promoSchema = z.object({
  id: z.string().trim().min(1).max(40),
  tipo: z.enum(["sugerencia", "promocion"]),
  titulo: z.string().trim().min(1, "Poné un título").max(60),
  descripcion: z.string().trim().max(160),
  productId: z.string().uuid().nullable(),
  /** 0 = domingo … 6 = sábado. Vacío = todos los días. */
  dias: z.array(z.number().int().min(0).max(6)).max(7),
  activa: z.boolean(),
});

export const promoListSchema = z.array(promoSchema).max(MAX_PROMOS, `Hasta ${MAX_PROMOS} sugerencias y promociones`);

export type Promo = z.infer<typeof promoSchema>;

/** Lee lo guardado en la configuración descartando entradas inválidas. */
export function parsePromos(raw: unknown): Promo[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const parsed = promoSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Día de la semana en Buenos Aires (el local trabaja en esa hora, no en UTC). */
export function weekdayInArgentina(now: Date): number {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "America/Argentina/Buenos_Aires" }).format(now);
  return WEEKDAY[name] ?? now.getUTCDay();
}

export function promosForToday(promos: readonly Promo[], now: Date = new Date()): Promo[] {
  const today = weekdayInArgentina(now);
  return promos.filter((p) => p.activa && (p.dias.length === 0 || p.dias.includes(today)));
}
