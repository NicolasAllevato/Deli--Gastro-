import { isOpenNow } from "../../../../src/lib/agent/hours.ts";
import { sessionIdleMs } from "./session.ts";
import { portalIdleHours } from "./portal.ts";

/** Configuración del bot leída de `global_config` (la edita el dueño en /admin/agente). Nada secreto. */
export interface BotSettings {
  active: boolean;
  transcribeAudio: boolean;
  name: string;
  /** `agente_nombre` tal cual está cargado; null si falta (el saludo dice "Soy el asistente de ..."). */
  agentName: string | null;
  tone: string;
  instructions: string;
  businessName: string;
  hours: { open: string; close: string };
  estimatedMinutes: number;
  paused: boolean;
  /** Fase 5: el bot toma pedidos por los endpoints internos. Apagado = se derivan a la web (`bot_orders_enabled`, el mismo flag del servidor). */
  ordersEnabled: boolean;
  /** Entrenamiento del agente (`bot_modo_entrenamiento`): los reclamos NO se derivan a una persona, ni con el local abierto. */
  trainingMode: boolean;
  /** Radio de envío en km (`radio_delivery_km`); null si no está cargado. */
  deliveryRadiusKm: number | null;
  /** Costo del envío por km (`costo_por_km`); null si no está cargado. */
  deliveryCostPerKm: number | null;
  /** Inactividad (ms) que abandona un pedido en armado: la sesión del bot arranca de nuevo (`bot_sesion_inactividad_min`, 150 min). */
  sessionIdleMs: number;
  /** Horas entre recordatorios del portal en consultas de precios o envío (`bot_portal_recordatorio_horas`, 24; 0 = apagado). */
  portalHours: number;
}

const positive = (value: unknown): number | null => {
  const n = typeof value === "string" ? Number(value.trim()) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
};

const text = (value: unknown, fallback: string, max: number): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;

/** Mismas claves y valores por defecto que `loadAgentSettings` del panel. */
export function settingsFromConfig(config: Record<string, unknown>): BotSettings {
  const minutes = Number(config.tiempo_entrega_min);
  return {
    active: config.agente_activo === true,
    transcribeAudio: config.agente_audios !== false,
    name: text(config.agente_nombre, "Deli", 40),
    agentName: text(config.agente_nombre, "", 40) || null,
    tone: text(config.agente_tono, "cálido, cercano y breve", 200),
    instructions: text(config.agente_instrucciones, "", 1000),
    businessName: text(config.negocio_nombre, "Deli-Gastro", 80),
    hours: { open: text(config.horario_apertura, "11:00", 5), close: text(config.horario_cierre, "23:00", 5) },
    estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 30,
    paused: config.modo_pausa === true || config.tienda_activa === false,
    // Igual que el servidor (handlers.ts): `true` o "true".
    ordersEnabled: config.bot_orders_enabled === true || config.bot_orders_enabled === "true",
    trainingMode: config.bot_modo_entrenamiento === true || config.bot_modo_entrenamiento === "true",
    deliveryRadiusKm: positive(config.radio_delivery_km),
    deliveryCostPerKm: positive(config.costo_por_km),
    sessionIdleMs: sessionIdleMs(config),
    portalHours: portalIdleHours(config),
  };
}

/** Clave de `global_config`: minutos que el bot calla en un chat tras un mensaje escrito desde la app WhatsApp Business. */
export const TAKEOVER_KEY = "bot_human_takeover_minutes";
export const DEFAULT_TAKEOVER_MINUTES = 120;
const MAX_TAKEOVER_MINUTES = 7 * 24 * 60;

/** Número (o texto numérico) positivo; inválido => 120. Se acota a 7 días. */
export function takeoverMinutesFromConfig(config: Record<string, unknown>): number {
  const raw = config[TAKEOVER_KEY];
  const minutes = typeof raw === "string" ? Number(raw.trim()) : raw;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 1) return DEFAULT_TAKEOVER_MINUTES;
  return Math.min(Math.floor(minutes), MAX_TAKEOVER_MINUTES);
}

export function openNow(settings: BotSettings, now: Date = new Date()): boolean {
  return !settings.paused && isOpenNow(settings.hours.open, settings.hours.close, now);
}
