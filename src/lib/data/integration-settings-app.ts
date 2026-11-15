/** `integration_settings` desde la app (DATA_BACKEND=d1): binding D1 único (getDb) + SETTINGS_ENC_KEY del entorno. */
import { readIntegrationSettings, writeIntegrationSettings } from "./integration-settings.ts";
import type { SqlDatabase } from "./sql.ts";

/** Clave de cifrado de la app (Worker secret de opsyn-dely). */
function appSettingsKey(): string | undefined {
  return process.env.SETTINGS_ENC_KEY;
}

async function baseDb(db?: SqlDatabase): Promise<SqlDatabase> {
  if (db) return db;
  const { getDb } = await import("./db.ts");
  return getDb();
}

export async function readAppSettings(keys: readonly string[], db?: SqlDatabase): Promise<Map<string, string>> {
  return readIntegrationSettings(await baseDb(db), keys, appSettingsKey());
}

export async function writeAppSettings(rows: ReadonlyArray<{ key: string; value: string }>, db?: SqlDatabase): Promise<void> {
  await writeIntegrationSettings(await baseDb(db), rows, appSettingsKey());
}
