import { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { createWhatsAppClient, type TemplateInfo, type WhatsAppClient } from "./client.ts";
import { isCoexistenceValue } from "./embedded-signup.ts";
import { readAppSettings, usesD1, writeAppSettings, type IntegrationSettingsDb as SqlDatabase } from "@/lib/data";

type Db = ReturnType<typeof createAdminClient>;

export interface WhatsAppSettings {
  accessToken: string | null;
  phoneNumberId: string | null;
  wabaId: string | null;
  appSecret: string | null;
  verifyToken: string | null;
  /** App ID y Config ID de Embedded Signup: públicos (los usa el SDK en el navegador). */
  appId: string | null;
  configId: string | null;
  /** "1"/"0": Embedded Signup con onboarding de la app WhatsApp Business (coexistencia). Vacío = no. */
  coexistence: string | null;
}

/** Coexistencia activa solo si el admin la activó (vacío = comportamiento anterior: estándar con PIN). */
export function isCoexistenceEnabled(s: Pick<WhatsAppSettings, "coexistence">): boolean {
  return isCoexistenceValue(s.coexistence);
}

/**
 * Nombres de las variables de entorno `WHATSAPP_*` que están tapando lo guardado en la base.
 * Con D1 lo guardado gana sobre el entorno: nunca tapan nada.
 */
export function envOverrides(names: readonly SettingName[]): string[] {
  if (usesD1()) return [];
  return names.filter((n) => fromEnv(n) !== null).map((n) => SOURCES[n].env);
}

export type SettingName = keyof WhatsAppSettings;

/**
 * Clave guardada y variable de entorno equivalente.
 * Supabase: el entorno gana sobre `integration_secrets`. D1: lo guardado (cifrado en `integration_settings`)
 * gana y el entorno queda de respaldo, así un número conectado desde el panel no queda tapado.
 */
const SOURCES: Record<SettingName, { key: string; env: string }> = {
  accessToken: { key: "whatsapp_access_token", env: "WHATSAPP_ACCESS_TOKEN" },
  phoneNumberId: { key: "whatsapp_phone_number_id", env: "WHATSAPP_PHONE_NUMBER_ID" },
  wabaId: { key: "whatsapp_waba_id", env: "WHATSAPP_WABA_ID" },
  appSecret: { key: "whatsapp_app_secret", env: "WHATSAPP_APP_SECRET" },
  verifyToken: { key: "whatsapp_verify_token", env: "WHATSAPP_VERIFY_TOKEN" },
  appId: { key: "whatsapp_app_id", env: "WHATSAPP_APP_ID" },
  configId: { key: "whatsapp_config_id", env: "WHATSAPP_CONFIG_ID" },
  coexistence: { key: "whatsapp_coexistence", env: "WHATSAPP_COEXISTENCE" },
};

const NAMES = Object.keys(SOURCES) as SettingName[];

function fromEnv(name: SettingName): string | null {
  const value = process.env[SOURCES[name].env]?.trim();
  return value ? value : null;
}

/** Lee filas guardadas: D1 cifrado o `integration_secrets` de Supabase según el backend. */
export async function readStoredSecrets(db: Db, keys: readonly string[], d1?: SqlDatabase): Promise<Map<string, string>> {
  if (usesD1()) return readAppSettings(keys, d1);
  const { data } = await db.from("integration_secrets").select("key, value").in("key", [...keys]);
  return new Map((data ?? []).map((r) => [r.key, r.value]));
}

/** Guarda filas: D1 cifrado o `integration_secrets` de Supabase según el backend. Lanza si falla. */
export async function writeStoredSecrets(
  db: Db,
  rows: Array<{ key: string; value: string }>,
  d1?: SqlDatabase,
): Promise<void> {
  if (rows.length === 0) return;
  if (usesD1()) {
    await writeAppSettings(rows, d1);
    return;
  }
  const { error } = await db.from("integration_secrets").upsert(rows, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function loadWhatsAppSettings(db: Db, d1?: SqlDatabase): Promise<WhatsAppSettings> {
  const keys = NAMES.map((n) => SOURCES[n].key);
  const stored = await readStoredSecrets(db, keys, d1);
  const savedFirst = usesD1();
  return Object.fromEntries(
    NAMES.map((n) => {
      const saved = stored.get(SOURCES[n].key)?.trim() || null;
      return [n, savedFirst ? (saved ?? fromEnv(n)) : (fromEnv(n) ?? saved)];
    }),
  ) as unknown as WhatsAppSettings;
}

/** Guarda solo los campos informados; un valor vacío no pisa lo que ya hay. */
export async function saveWhatsAppSettings(
  db: Db,
  patch: Partial<Record<SettingName, string | undefined>>,
  d1?: SqlDatabase,
): Promise<void> {
  const rows = NAMES.flatMap((n) => {
    const value = patch[n]?.trim();
    return value ? [{ key: SOURCES[n].key, value }] : [];
  });
  try {
    await writeStoredSecrets(db, rows, d1);
  } catch (error: unknown) {
    throw new Error(`No se pudo guardar la configuración: ${error instanceof Error ? error.message : "error desconocido"}`);
  }
}

/** ¿Alcanza para enviar mensajes? (token + número). */
export function canSend(s: WhatsAppSettings): s is WhatsAppSettings & { accessToken: string; phoneNumberId: string } {
  return Boolean(s.accessToken && s.phoneNumberId);
}

/** ¿Alcanza para recibir mensajes? (firma + verificación del webhook). */
export function canReceive(s: WhatsAppSettings): boolean {
  return Boolean(s.appSecret && s.verifyToken);
}

/** Plantillas "creadas" en el demo (en memoria, como el resto de los datos de ejemplo). */
const demoTemplates = new Map<string, TemplateInfo>();
let demoSubscribed = false;

/** Cliente simulado del modo demo: no sale a internet ni gasta mensajes de Meta. */
function createDemoClient(): WhatsAppClient {
  const wamid = () => `wamid.demo-${crypto.randomUUID()}`;
  return {
    sendText: async () => wamid(),
    sendTemplate: async () => wamid(),
    listTemplates: async () => [...demoTemplates.values()],
    createTemplate: async (payload) => {
      demoTemplates.set(payload.name, {
        name: payload.name, status: "APPROVED", category: payload.category, language: payload.language,
      });
      return { id: `demo-${payload.name}`, status: "APPROVED", category: payload.category };
    },
    getPhoneInfo: async () => ({ display_phone_number: "+54 9 11 0000-0000", verified_name: "Deli-Gastro (demo)" }),
    getWabaInfo: async () => ({ id: "demo-waba", name: "Deli-Gastro (demo)" }),
    isAppSubscribed: async () => demoSubscribed,
    subscribeApp: async () => {
      demoSubscribed = true;
      return { success: true };
    },
    registerPhone: async (pin) => {
      if (!/^\d{6}$/.test(pin)) throw new Error("El PIN tiene que ser de 6 dígitos.");
    },
    downloadMedia: async () => {
      throw new Error("El modo demo no descarga audios.");
    },
  };
}

export function clientFor(s: WhatsAppSettings): WhatsAppClient | null {
  if (!canSend(s)) return null;
  if (isDemoMode()) return createDemoClient();
  return createWhatsAppClient({
    accessToken: s.accessToken,
    phoneNumberId: s.phoneNumberId,
    wabaId: s.wabaId ?? undefined,
  });
}
