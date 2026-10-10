import { createAdminClient } from "@/utils/supabase/admin";
import { readConfig } from "@/lib/orders-server";
import { DEFAULT_MODEL } from "./openai.ts";

type Db = ReturnType<typeof createAdminClient>;

const OPENAI_KEY = "openai_api_key";

/** Conversación reservada para las pruebas del panel (no es un teléfono real). */
export const TEST_PHONE = "test-admin";

export interface AgentSettings {
  active: boolean;
  name: string;
  tone: string;
  instructions: string;
  businessName: string;
  hours: { open: string; close: string };
  estimatedMinutes: number;
  paused: boolean;
  model: string;
}

const text = (value: unknown, fallback: string, max: number): string =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;

/** Configuración pública del agente (`global_config`): nada secreto va ahí. */
export async function loadAgentSettings(db: Db): Promise<AgentSettings> {
  const config = await readConfig(db);
  const minutes = Number(config.tiempo_entrega_min);
  return {
    active: config.agente_activo === true,
    name: text(config.agente_nombre, "Deli", 40),
    tone: text(config.agente_tono, "cálido, cercano y breve", 200),
    instructions: text(config.agente_instrucciones, "", 1000),
    businessName: text(config.negocio_nombre, "Deli-Gastro", 80),
    hours: {
      open: text(config.horario_apertura, "11:00", 5),
      close: text(config.horario_cierre, "23:00", 5),
    },
    estimatedMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : 30,
    paused: config.modo_pausa === true || config.tienda_activa === false,
    model: text(config.agente_modelo, DEFAULT_MODEL, 60),
  };
}

/** Clave de OpenAI: el entorno gana sobre la guardada desde el panel. */
export async function loadOpenAIKey(db: Db): Promise<string | null> {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  const { data } = await db.from("integration_secrets").select("value").eq("key", OPENAI_KEY).maybeSingle();
  return data?.value ?? null;
}

export async function saveOpenAIKey(db: Db, apiKey: string): Promise<void> {
  const { error } = await db.from("integration_secrets").upsert({ key: OPENAI_KEY, value: apiKey.trim() }, { onConflict: "key" });
  if (error) throw new Error(`No se pudo guardar la clave: ${error.message}`);
}
