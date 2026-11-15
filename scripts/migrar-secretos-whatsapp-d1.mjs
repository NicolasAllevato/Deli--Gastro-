#!/usr/bin/env node
/**
 * Copia la configuración sensible de Supabase (`integration_secrets`) a D1 (`integration_settings`), cifrada.
 *
 * NO toca D1: genera un .sql fuera del repo (%LOCALAPPDATA%\deli-gastro\secretos-d1\) para aplicarlo a mano:
 *   npx wrangler d1 execute deli-gastro --remote --file "<ruta que imprime>"
 * y después borrar ese archivo. Nunca imprime valores, solo las claves migradas.
 *
 * Variables de entorno: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SETTINGS_ENC_KEY (32 bytes base64,
 * la MISMA cargada como Worker secret en opsyn-dely y whatsapp-bot).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { webcrypto as crypto } from "node:crypto";

/** Solo estas claves (las que leen la app y el bot). */
const KEYS = [
  "whatsapp_access_token", "whatsapp_phone_number_id", "whatsapp_waba_id", "whatsapp_app_secret",
  "whatsapp_verify_token", "whatsapp_app_id", "whatsapp_config_id", "whatsapp_coexistence",
  "whatsapp_connected_by", "openai_api_key",
];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`Falta la variable de entorno ${name}.`);
    process.exit(1);
  }
  return value;
}

async function encrypt(plain, key) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `v1:${Buffer.from(iv).toString("base64")}:${Buffer.from(ct).toString("base64")}`;
}

const sqlText = (s) => `'${String(s).replace(/'/g, "''")}'`;

async function main() {
  const url = required("SUPABASE_URL").replace(/\/+$/, "");
  const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
  const rawKey = Buffer.from(required("SETTINGS_ENC_KEY"), "base64");
  if (rawKey.length !== 32) {
    console.error("SETTINGS_ENC_KEY tiene que medir 32 bytes (base64).");
    process.exit(1);
  }
  const key = await crypto.subtle.importKey("raw", rawKey, { name: "AES-GCM" }, false, ["encrypt"]);

  const filter = `in.(${KEYS.join(",")})`;
  const res = await fetch(`${url}/rest/v1/integration_secrets?select=key,value&key=${encodeURIComponent(filter)}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!res.ok) {
    console.error(`Supabase respondió ${res.status}. Revisá SUPABASE_URL y la service role key.`);
    process.exit(1);
  }
  const rows = (await res.json()).filter((r) => typeof r.value === "string" && r.value.trim());
  if (rows.length === 0) {
    console.log("No hay valores para migrar.");
    return;
  }

  const now = new Date().toISOString();
  const lines = ["-- Generado por scripts/migrar-secretos-whatsapp-d1.mjs. Contiene secretos cifrados: borrar después de aplicar."];
  for (const r of rows) {
    lines.push(
      `INSERT INTO integration_settings (key, value_enc, updated_at, updated_by) VALUES (${sqlText(r.key)}, ${sqlText(await encrypt(r.value.trim(), key))}, ${sqlText(now)}, 'migracion-supabase') ` +
        "ON CONFLICT (key) DO UPDATE SET value_enc = excluded.value_enc, updated_at = excluded.updated_at, updated_by = excluded.updated_by;",
    );
  }

  const base = process.env.LOCALAPPDATA ?? join(homedir(), ".local", "share");
  const dir = join(base, "deli-gastro", "secretos-d1");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `integration_settings-${now.replace(/[:.]/g, "-")}.sql`);
  writeFileSync(file, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });

  console.log(`Claves migradas (${rows.length}): ${rows.map((r) => r.key).join(", ")}`);
  console.log(`SQL generado en: ${file}`);
  console.log('Aplicar con: npx wrangler d1 execute deli-gastro --remote --file "<ruta>" (y borrar el archivo después).');
}

main().catch((error) => {
  console.error("Falló la migración:", error instanceof Error ? error.name : "error");
  process.exit(1);
});
