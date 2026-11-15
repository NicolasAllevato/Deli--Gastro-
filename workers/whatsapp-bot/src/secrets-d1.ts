import { readIntegrationSettings } from "../../../src/lib/data/integration-settings.ts";
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";

export interface BotSecrets {
  appSecret: string | null;
  verifyToken: string | null;
  phoneNumberId: string | null;
  accessToken: string | null;
}

export interface BotSecretsEnv {
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  SETTINGS_ENC_KEY?: string;
}

/** Mismas claves que guarda el panel (src/lib/whatsapp/config.ts). */
const KEYS = {
  appSecret: "whatsapp_app_secret",
  verifyToken: "whatsapp_verify_token",
  phoneNumberId: "whatsapp_phone_number_id",
  accessToken: "whatsapp_access_token",
} as const;

export const D1_SECRETS_TTL_MS = 60_000;

let cache: { value: BotSecrets; at: number } | null = null;

/** Solo para tests. */
export function resetD1SecretsCache(): void {
  cache = null;
}

function envValue(x: string | undefined): string | null {
  return x && x.trim() ? x.trim() : null;
}

/**
 * Credenciales del bot con DATA_BACKEND=d1: lo guardado desde el panel (D1 cifrado) gana; cada campo
 * vacío cae al Worker secret. Caché por instancia de 60 s: un cambio en el panel llega en ≤ 1 minuto.
 * Si D1 o la clave fallan, se usa el entorno (se avisa sin datos sensibles).
 */
export async function loadD1BotSecrets(db: SqlDatabase, env: BotSecretsEnv, now: number = Date.now()): Promise<BotSecrets> {
  if (cache && now - cache.at < D1_SECRETS_TTL_MS) return cache.value;
  let stored = new Map<string, string>();
  try {
    stored = await readIntegrationSettings(db, Object.values(KEYS), env.SETTINGS_ENC_KEY, (m) => console.error(m));
  } catch (error: unknown) {
    console.error("[whatsapp-bot] no se pudo leer integration_settings; uso Worker secrets", error instanceof Error ? error.name : "error");
  }
  const pick = (name: keyof typeof KEYS, fromEnv: string | undefined) => stored.get(KEYS[name])?.trim() || envValue(fromEnv);
  const value: BotSecrets = {
    appSecret: pick("appSecret", env.WHATSAPP_APP_SECRET),
    verifyToken: pick("verifyToken", env.WHATSAPP_VERIFY_TOKEN),
    phoneNumberId: pick("phoneNumberId", env.WHATSAPP_PHONE_NUMBER_ID),
    accessToken: pick("accessToken", env.WHATSAPP_ACCESS_TOKEN),
  };
  cache = { value, at: now };
  return value;
}
