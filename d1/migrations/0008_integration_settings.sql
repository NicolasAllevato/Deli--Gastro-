-- Configuración sensible (credenciales de WhatsApp/Meta, clave de OpenAI, quién conectó el número).
-- Reemplaza a integration_secrets de Supabase con DATA_BACKEND=d1.
-- value_enc: AES-256-GCM, formato `v1:<iv b64>:<cifrado b64>`, clave en el Worker secret SETTINGS_ENC_KEY.
-- NO está en la lista blanca del adaptador genérico (src/lib/data/plan-sql.ts): solo la tocan
-- src/lib/data/integration-settings.ts (rutas admin) y el Worker whatsapp-bot.
CREATE TABLE IF NOT EXISTS integration_settings (
  key        TEXT PRIMARY KEY,
  value_enc  TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
