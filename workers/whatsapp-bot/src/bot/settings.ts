import { isOpenNow } from "../../../../src/lib/agent/hours.ts";

/** Configuración del bot leída de `global_config` (la edita el dueño en /admin/agente). Nada secreto. */
export interface BotSettings {
  active: boolean;
  transcribeAudio: boolean;
  name: string;
  tone: string;
  instructions: string;
  businessName: string;
  hours: { open: string; close: string };
  estimatedMinutes: number;
  paused: boolean;
  /** Fase 5: el bot toma pedidos por los endpoints internos. Apagado = se derivan a la web (`bot_orders_enabled`, el mismo flag del servidor). */
  ordersEnabled: boolean;
}

const text = (value: unknown, fallback: string, max: number): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;

/** Mismas claves y valores por defecto que `loadAgentSettings` del panel. */
export function settingsFromConfig(config: Record<string, unknown>): BotSettings {
  const minutes = Number(config.tiempo_entrega_min);
  return {
    active: config.agente_activo === true,
    transcribeAudio: config.agente_audios !== false,
    name: text(config.agente_nombre, "Deli", 40),
    tone: text(config.agente_tono, "cálido, cercano y breve", 200),
    instructions: text(config.agente_instrucciones, "", 1000),
    businessName: text(config.negocio_nombre, "Deli-Gastro", 80),
    hours: { open: text(config.horario_apertura, "11:00", 5), close: text(config.horario_cierre, "23:00", 5) },
    estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 30,
    paused: config.modo_pausa === true || config.tienda_activa === false,
    // Igual que el servidor (handlers.ts): `true` o "true".
    ordersEnabled: config.bot_orders_enabled === true || config.bot_orders_enabled === "true",
  };
}

export function openNow(settings: BotSettings, now: Date = new Date()): boolean {
  return !settings.paused && isOpenNow(settings.hours.open, settings.hours.close, now);
}
