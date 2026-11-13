-- =============================================================================
-- Deli-Gastro → Cloudflare D1 (SQLite) · esquema inicial
-- Fuente: estado real de Supabase (proyecto wlznhichyivfcqwbosyi, 2026-11-12),
--         equivalente a supabase/migrations/001–030.
-- SOLO tablas de esta app. NO se migran las del sistema ajeno de recetas/insumos
-- (recetas, insumos_maestro, ordenes_compra, ordenes_detalle, ventas_turno,
--  ventas_detalle, productos_vendidos, mermas, promos, promo_items, proveedores,
--  receta_*, unidades, menu_personal_planning, pedido_semanal_template,
--  precios_historico_insumos, perfiles_usuario, flujo_financiero, sync_log,
--  telegram_sessions, reclamos, vistas vista_*).
--
-- Convenciones de conversión (Postgres → SQLite):
--   uuid          → TEXT (36 chars, minúsculas). Default: generado en código
--                   (crypto.randomUUID()); el DEFAULT de abajo es un fallback v4.
--   timestamptz   → TEXT ISO-8601 UTC con milisegundos y 'Z'
--                   ('2026-11-12T15:04:05.123Z'). Ordena bien lexicográficamente.
--                   Default: strftime('%Y-%m-%dT%H:%M:%fZ','now').
--   date          → TEXT 'YYYY-MM-DD' (día en America/Argentina/Buenos_Aires,
--                   calculado en código: SQLite no tiene zonas horarias).
--   bool          → INTEGER 0/1 con CHECK.
--   numeric       → REAL. Los montos son pesos con a lo sumo 2 decimales; redondear
--                   en código (Math.round(x*100)/100). Si se quiere exactitud total:
--                   guardar centavos INTEGER (decisión abierta D6 del plan).
--   int2/int4/int8→ INTEGER (64 bits en SQLite).
--   float4/float8 → REAL.
--   jsonb         → TEXT con CHECK (json_valid(...)). Se consulta con json_extract().
--   FK a auth.users(id) → FK a users(id) (tabla propia que reemplaza Supabase Auth).
--   Índices parciales → SQLite los soporta (WHERE ...).
--   Índice por expresión clients_phone_digits_idx (regexp_replace) → columna
--   phone_digits mantenida en código + índice normal (SQLite no trae regexp).
--   Triggers set_updated_at → triggers SQLite equivalentes (abajo).
--   Triggers de Realtime (notify_*), handle_new_user, protect_client_columns,
--   orders_link_fudo_client, update_client_points → pasan a CÓDIGO (ver plan §5).
--   RLS → no existe en D1: la autorización vive en la capa de acceso a datos.
--
-- D1 aplica PRAGMA foreign_keys = ON siempre.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Autenticación propia (reemplaza auth.users de Supabase). Ver plan §4.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,                       -- mismo uuid que auth.users para no romper FKs
  email           TEXT UNIQUE COLLATE NOCASE,
  phone           TEXT UNIQUE,
  password_hash   TEXT,                                   -- PBKDF2-SHA256 (WebCrypto) o NULL si solo OTP/PIN
  legacy_bcrypt   TEXT,                                   -- hash bcrypt copiado de Supabase; se re-hashea al primer login
  role            TEXT NOT NULL DEFAULT 'cliente'
                  CHECK (role IN ('admin','cliente','repartidor')),   -- antes app_metadata.role
  email_confirmed_at TEXT,
  banned_until    TEXT,                                   -- antes auth.setBlocked / ban_duration
  user_metadata   TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(user_metadata)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_sign_in_at TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                           -- sha256 del token opaco de la cookie
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  user_agent  TEXT,
  ip          TEXT
);
CREATE INDEX IF NOT EXISTS sessions_user_idx    ON sessions (user_id);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires_at);

-- Tokens de un solo uso: verificación de email, recuperación, magic link (antes generateLink/verifyOtp).
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL CHECK (purpose IN ('signup','recovery','magiclink','email_change')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(4))||'-'||hex(randomblob(2))||'-4'||substr(hex(randomblob(2)),2)||'-'||substr('89ab',1+abs(random())%4,1)||substr(hex(randomblob(2)),2)||'-'||hex(randomblob(6)))),
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  points_per_100  REAL CHECK (points_per_100 IS NULL OR points_per_100 >= 0),
  fudo_id         INTEGER UNIQUE,
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','fudo')),
  fudo_synced_at  TEXT
);

CREATE TABLE IF NOT EXISTS products (
  id              TEXT PRIMARY KEY,
  category_id     TEXT REFERENCES categories(id) ON DELETE SET NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  price           REAL NOT NULL DEFAULT 0,
  image_url       TEXT NOT NULL DEFAULT '',               -- ya apunta a R2 (Worker uploads)
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  points_per_100  REAL,
  fudo_id         INTEGER,
  source          TEXT NOT NULL DEFAULT 'manual',
  fudo_synced_at  TEXT
);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_fudo_id_idx  ON products (fudo_id);

-- ---------------------------------------------------------------------------
-- Clientes y fidelidad
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS clients (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  phone               TEXT,
  phone_digits        TEXT,   -- NUEVA: últimos 10 dígitos de phone, la mantiene el código (reemplaza índice por regexp)
  address             TEXT,
  tier                TEXT NOT NULL DEFAULT 'Bronce' CHECK (tier IN ('Bronce','Plata','Oro','Platino')),
  total_points        INTEGER NOT NULL DEFAULT 0 CHECK (total_points >= 0),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  wa_marketing_opt_in INTEGER NOT NULL DEFAULT 0 CHECK (wa_marketing_opt_in IN (0,1)),
  fudo_customer_id    INTEGER UNIQUE,
  email               TEXT,
  source              TEXT NOT NULL DEFAULT 'app' CHECK (source IN ('app','fudo')),
  channel             TEXT CHECK (channel IS NULL OR channel IN ('app','local','pedidosya','rappi','morfy')),
  is_anonymous        INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1))
);
CREATE INDEX IF NOT EXISTS clients_phone_digits_idx ON clients (phone_digits);
-- Igual que en Postgres: lower(name) + channel único entre anónimos (índice parcial por expresión, soportado).
CREATE UNIQUE INDEX IF NOT EXISTS clients_anonymous_unique ON clients (lower(name), channel) WHERE is_anonymous = 1;

CREATE TABLE IF NOT EXISTS points_ledger (
  id          TEXT PRIMARY KEY,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id    TEXT REFERENCES orders(id) ON DELETE SET NULL,
  delta       INTEGER NOT NULL,
  description TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS points_ledger_client_idx ON points_ledger (client_id, created_at);

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS orders (
  id                   TEXT PRIMARY KEY,
  client_id            TEXT REFERENCES clients(id) ON DELETE SET NULL,
  status               TEXT NOT NULL DEFAULT 'Recibidos'
                       CHECK (status IN ('Recibidos','En Preparación','En Camino','Finalizados','Cancelado')),
  items_desc           TEXT NOT NULL,
  total                REAL NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  delivery_fee         REAL NOT NULL DEFAULT 0 CHECK (delivery_fee >= 0),
  delivery_address     TEXT,
  delivery_lat         REAL CHECK (delivery_lat BETWEEN -90 AND 90),
  delivery_lng         REAL CHECK (delivery_lng BETWEEN -180 AND 180),
  payment_method       TEXT CHECK (payment_method IS NULL OR payment_method IN ('Efectivo','Tarjeta','Mercado Pago')),
  notes                TEXT CHECK (notes IS NULL OR length(notes) <= 300),
  courier_name         TEXT,
  accepted_at          TEXT,
  ready_at             TEXT,
  picked_up_at         TEXT,
  delivered_at         TEXT,
  channel              TEXT NOT NULL DEFAULT 'web' CHECK (channel IN ('web','whatsapp','mostrador','fudo')),
  survey_sent_at       TEXT,
  points_earned        INTEGER CHECK (points_earned IS NULL OR points_earned >= 0),
  fudo_order_id        INTEGER UNIQUE,
  fudo_sync_status     TEXT CHECK (fudo_sync_status IN ('pending','sent','failed','skipped')),
  fudo_error           TEXT,
  fudo_attempts        INTEGER NOT NULL DEFAULT 0,
  fudo_synced_at       TEXT,
  delivered_lat        REAL CHECK (delivered_lat BETWEEN -90 AND 90),
  delivered_lng        REAL CHECK (delivered_lng BETWEEN -180 AND 180),
  delivered_accuracy_m REAL,
  fudo_sale_type       TEXT CHECK (fudo_sale_type IN ('DELIVERY','TAKEAWAY','EAT-IN')),
  fudo_sale_state      TEXT,
  fudo_source          TEXT CHECK (fudo_source IS NULL OR fudo_source IN ('pedidosya','rappi','morfy','local')),
  customer_name        TEXT,
  fudo_payment         TEXT,
  fudo_payments        TEXT CHECK (fudo_payments IS NULL OR (json_valid(fudo_payments) AND json_type(fudo_payments) = 'array')),
  geocode_attempts     INTEGER NOT NULL DEFAULT 0 CHECK (geocode_attempts >= 0),
  delivered_in_app     INTEGER NOT NULL DEFAULT 0 CHECK (delivered_in_app IN (0,1))
);
CREATE INDEX IF NOT EXISTS orders_client_created_idx     ON orders (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_status_idx             ON orders (status);
CREATE INDEX IF NOT EXISTS orders_created_at_idx         ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_survey_idx             ON orders (delivered_at) WHERE status = 'Finalizados' AND survey_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS orders_fudo_pending_idx       ON orders (created_at) WHERE fudo_sync_status IN ('pending','failed');
CREATE INDEX IF NOT EXISTS orders_fudo_source_idx        ON orders (fudo_source) WHERE fudo_source IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_geocode_pendiente_idx  ON orders (created_at DESC)
  WHERE delivery_lat IS NULL AND delivery_address IS NOT NULL AND channel = 'fudo' AND fudo_sale_type = 'DELIVERY';
CREATE INDEX IF NOT EXISTS orders_finalizados_created_idx ON orders (created_at DESC, id DESC) WHERE status = 'Finalizados';

CREATE TABLE IF NOT EXISTS order_items (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  TEXT REFERENCES products(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_price  REAL NOT NULL CHECK (unit_price >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  event       TEXT NOT NULL,
  actor       TEXT,
  detail      TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS order_events_order_idx ON order_events (order_id, created_at);

CREATE TABLE IF NOT EXISTS reviews (
  id          TEXT PRIMARY KEY,
  order_id    TEXT NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
  client_id   TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  feedback    TEXT CHECK (feedback IS NULL OR length(feedback) <= 1000),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS reviews_client_idx ON reviews (client_id);

CREATE TABLE IF NOT EXISTS payment_intents (
  id                TEXT PRIMARY KEY,
  client_id         TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  channel           TEXT NOT NULL CHECK (channel IN ('web','whatsapp','mostrador')),
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','cancelled','expired','refunded')),
  total             REAL NOT NULL CHECK (total >= 0),
  snapshot          TEXT NOT NULL CHECK (json_valid(snapshot)),
  mp_preference_id  TEXT,
  checkout_url      TEXT,
  mp_payment_id     TEXT,
  order_id          TEXT REFERENCES orders(id) ON DELETE SET NULL,
  expires_at        TEXT NOT NULL,
  refund_error      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS payment_intents_client_idx  ON payment_intents (client_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payment_intents_order_idx   ON payment_intents (order_id) WHERE order_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS payment_intents_pending_idx ON payment_intents (expires_at) WHERE status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS payment_intents_mp_payment_uidx ON payment_intents (mp_payment_id) WHERE mp_payment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS delivery_zones (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 60),
  shape       TEXT NOT NULL CHECK (json_valid(shape) AND json_extract(shape,'$.type') IN ('circle','polygon')),
  fee         REAL NOT NULL DEFAULT 0 CHECK (fee >= 0),
  min_order   REAL NOT NULL DEFAULT 0 CHECK (min_order >= 0),
  sort_order  INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS reports_daily (
  id               TEXT PRIMARY KEY,
  report_date      TEXT NOT NULL UNIQUE,                  -- 'YYYY-MM-DD'
  total_income     REAL NOT NULL DEFAULT 0,
  total_orders     INTEGER NOT NULL DEFAULT 0,
  orders_cancelled INTEGER NOT NULL DEFAULT 0,
  generated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ---------------------------------------------------------------------------
-- Repartidores
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS couriers (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  pin_hash      TEXT NOT NULL UNIQUE,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  pin_encrypted TEXT
);

CREATE TABLE IF NOT EXISTS courier_locations (
  user_id      TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  courier_name TEXT NOT NULL,
  lat          REAL NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng          REAL NOT NULL CHECK (lng BETWEEN -180 AND 180),
  accuracy_m   REAL,
  heading      REAL,
  speed_mps    REAL,
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS courier_locations_updated_idx ON courier_locations (updated_at DESC);

CREATE TABLE IF NOT EXISTS courier_shifts (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  courier_name TEXT NOT NULL CHECK (length(courier_name) BETWEEN 1 AND 60),
  shift_day    TEXT NOT NULL,                             -- 'YYYY-MM-DD' (hora Argentina)
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at   TEXT,
  UNIQUE (user_id, shift_day)
);
CREATE INDEX IF NOT EXISTS courier_shifts_day_status ON courier_shifts (shift_day, status);

-- ---------------------------------------------------------------------------
-- Configuración, legales, secretos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS global_config (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL CHECK (json_valid(value)),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- OJO: en Postgres solo la leía el rol deli_bot / service-role. En D1 cualquier
-- binding tiene acceso total: decisión abierta D5 (moverlos a Secrets Store / secretos de Worker).
CREATE TABLE IF NOT EXISTS integration_secrets (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email       TEXT,
  role        TEXT,
  document    TEXT NOT NULL CHECK (document IN ('terminos','privacidad')),
  version     TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip          TEXT,
  user_agent  TEXT,
  UNIQUE (user_id, document, version)
);
CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx     ON legal_acceptances (user_id);
CREATE INDEX IF NOT EXISTS legal_acceptances_accepted_idx ON legal_acceptances (accepted_at DESC);

-- ---------------------------------------------------------------------------
-- Fudo
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS fudo_product_map (
  product_id      TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  fudo_product_id INTEGER NOT NULL,
  fudo_name       TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS fudo_payment_map (
  payment_method          TEXT PRIMARY KEY,
  fudo_payment_method_id  INTEGER NOT NULL,
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS fudo_sync_runs (
  id                    TEXT PRIMARY KEY,
  ran_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ok                    INTEGER NOT NULL CHECK (ok IN (0,1)),
  categories_created    INTEGER NOT NULL DEFAULT 0,
  categories_updated    INTEGER NOT NULL DEFAULT 0,
  products_created      INTEGER NOT NULL DEFAULT 0,
  products_updated      INTEGER NOT NULL DEFAULT 0,
  products_deactivated  INTEGER NOT NULL DEFAULT 0,
  error                 TEXT,
  kind                  TEXT NOT NULL DEFAULT 'catalog' CHECK (kind IN ('catalog','sales','customers'))
);
CREATE INDEX IF NOT EXISTS fudo_sync_runs_ran_at_idx ON fudo_sync_runs (ran_at DESC);

-- ---------------------------------------------------------------------------
-- WhatsApp
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wa_conversations (
  id               TEXT PRIMARY KEY,
  client_phone     TEXT NOT NULL UNIQUE,
  client_id        TEXT REFERENCES clients(id) ON DELETE SET NULL,
  contact_name     TEXT,
  state            TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(state)),
  human_takeover   INTEGER NOT NULL DEFAULT 0 CHECK (human_takeover IN (0,1)),
  last_inbound_at  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  bot_paused_until TEXT
);
CREATE INDEX IF NOT EXISTS wa_conversations_client_idx ON wa_conversations (client_id);

CREATE TABLE IF NOT EXISTS wa_messages (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES wa_conversations(id) ON DELETE CASCADE,
  wamid           TEXT UNIQUE,
  direction       TEXT NOT NULL CHECK (direction IN ('in','out')),
  type            TEXT NOT NULL,
  body            TEXT,
  status          TEXT,
  tokens          INTEGER CHECK (tokens IS NULL OR tokens >= 0),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS wa_messages_conversation_idx ON wa_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS wa_campaigns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  segment     TEXT NOT NULL CHECK (json_valid(segment)),
  message     TEXT NOT NULL CHECK (length(message) BETWEEN 1 AND 300),
  status      TEXT NOT NULL DEFAULT 'sending' CHECK (status IN ('sending','done','failed')),
  recipients  INTEGER NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  sent        INTEGER NOT NULL DEFAULT 0 CHECK (sent >= 0),
  failed      INTEGER NOT NULL DEFAULT 0 CHECK (failed >= 0),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  finished_at TEXT
);

-- ---------------------------------------------------------------------------
-- Triggers updated_at (equivalentes a set_updated_at()). La condición WHEN evita
-- recursión: solo actúan si el UPDATE no tocó updated_at a mano.
-- ---------------------------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS orders_updated_at AFTER UPDATE ON orders
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE orders SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS clients_updated_at AFTER UPDATE ON clients
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE clients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS categories_updated_at AFTER UPDATE ON categories
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE categories SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS products_updated_at AFTER UPDATE ON products
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE products SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS delivery_zones_updated_at AFTER UPDATE ON delivery_zones
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE delivery_zones SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;
CREATE TRIGGER IF NOT EXISTS wa_conversations_updated_at AFTER UPDATE ON wa_conversations
  WHEN NEW.updated_at = OLD.updated_at
  BEGIN UPDATE wa_conversations SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = NEW.id; END;

-- update_client_points(): suma el delta al cliente al insertar en el ledger.
-- Se puede quedar como trigger SQLite (atómico dentro del mismo statement).
CREATE TRIGGER IF NOT EXISTS points_ledger_after_insert AFTER INSERT ON points_ledger
  BEGIN
    UPDATE clients SET total_points = max(0, total_points + NEW.delta) WHERE id = NEW.client_id;
  END;

-- Marca de migración (la usa scripts/migrar-datos-d1.mjs para conteos).
CREATE TABLE IF NOT EXISTS _migracion (
  tabla        TEXT PRIMARY KEY,
  filas_origen INTEGER NOT NULL,
  importado_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
