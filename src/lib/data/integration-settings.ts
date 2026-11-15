/**
 * Configuración sensible (credenciales de Meta, clave de OpenAI, etc.) en D1, cifrada con AES-GCM.
 *
 * La tabla `integration_settings` NO está en la lista blanca del adaptador genérico (plan-sql): solo se
 * llega acá desde código de servidor que ya validó al admin (o desde el Worker del bot). Lo compartido con
 * el Worker whatsapp-bot son `readIntegrationSettings`/`writeIntegrationSettings`, que reciben la base y la clave.
 */
import { decryptSetting, encryptSetting } from "../crypto/settings-cipher.ts";
import type { SqlDatabase } from "./sql.ts";

export interface IntegrationSettingsLog {
  (message: string): void;
}

/** Lee y descifra las claves pedidas. Un valor que no se puede descifrar se omite (y se avisa sin datos). */
export async function readIntegrationSettings(
  db: SqlDatabase,
  keys: readonly string[],
  encKey: string | null | undefined,
  log: IntegrationSettingsLog = (m) => console.error(m),
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (keys.length === 0) return out;
  const { results } = await db
    .prepare("SELECT key, value_enc FROM integration_settings WHERE key IN (SELECT value FROM json_each(?))")
    .bind(JSON.stringify(keys))
    .all<{ key: string; value_enc: string }>();
  for (const row of results) {
    try {
      out.set(row.key, await decryptSetting(row.value_enc, encKey));
    } catch (error: unknown) {
      log(`[integration-settings] no se pudo descifrar ${row.key}: ${error instanceof Error ? error.name : "error"}`);
    }
  }
  return out;
}

/** Cifra y guarda (upsert) todas las filas en un solo batch atómico. */
export async function writeIntegrationSettings(
  db: SqlDatabase,
  rows: ReadonlyArray<{ key: string; value: string }>,
  encKey: string | null | undefined,
  updatedBy: string | null = null,
): Promise<void> {
  if (rows.length === 0) return;
  const now = new Date().toISOString();
  const statements = await Promise.all(
    rows.map(async ({ key, value }) =>
      db
        .prepare(
          `INSERT INTO integration_settings (key, value_enc, updated_at, updated_by) VALUES (?, ?, ?, ?)
           ON CONFLICT (key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        )
        .bind(key, await encryptSetting(value, encKey), now, updatedBy),
    ),
  );
  await db.batch(statements);
}
