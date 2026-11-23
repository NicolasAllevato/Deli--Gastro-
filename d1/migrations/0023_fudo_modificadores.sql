-- Modificadores de Fudo (sabores de la docena de empanadas, bebidas de las promos): grupos, opciones y qué
-- producto usa cada grupo. Solo aditiva. Los llena el sync de catálogo del fudo-gateway (GET product-modifiers-groups
-- y product-modifiers). Una opción apunta a un producto de Fudo (el sabor, de $0, en «Opciones»): nombre y precio
-- salen de ese producto. NO hay migración Supabase equivalente: DATA_BACKEND=d1 en producción y Supabase es legado;
-- en modo Supabase el sync de modificadores se omite con un aviso.
CREATE TABLE IF NOT EXISTS fudo_modifier_groups (
  fudo_id   INTEGER PRIMARY KEY,
  name      TEXT NOT NULL,
  min_qty   REAL,
  max_qty   REAL,
  required  INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  kind      TEXT,
  synced_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS fudo_modifier_options (
  -- id del ProductModifier en Fudo
  fudo_id         INTEGER PRIMARY KEY,
  group_fudo_id   INTEGER NOT NULL REFERENCES fudo_modifier_groups (fudo_id) ON DELETE CASCADE,
  -- producto de Fudo que es el sabor o la bebida
  product_fudo_id INTEGER NOT NULL,
  name            TEXT NOT NULL,
  price_cents     INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  position        INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1))
);
CREATE INDEX IF NOT EXISTS fudo_modifier_options_group_idx ON fudo_modifier_options (group_fudo_id);
CREATE INDEX IF NOT EXISTS fudo_modifier_options_product_idx ON fudo_modifier_options (product_fudo_id);

CREATE TABLE IF NOT EXISTS fudo_product_groups (
  product_fudo_id INTEGER NOT NULL,
  group_fudo_id   INTEGER NOT NULL REFERENCES fudo_modifier_groups (fudo_id) ON DELETE CASCADE,
  PRIMARY KEY (product_fudo_id, group_fudo_id)
);
CREATE INDEX IF NOT EXISTS fudo_product_groups_group_idx ON fudo_product_groups (group_fudo_id);
CREATE INDEX IF NOT EXISTS fudo_product_groups_product_idx ON fudo_product_groups (product_fudo_id);

-- Docena de empanadas: producto de Fudo, unidades, y empanada suelta (id Fudo) -> sabor equivalente del grupo
-- «Elige tu Relleno» (id Fudo del producto sabor).
INSERT OR IGNORE INTO global_config (key, value) VALUES
  ('docena_fudo_id', '212'),
  ('docena_unidades', '12'),
  ('empanada_gustos_map', '{"31":200,"32":197,"33":193,"34":202,"35":201,"97":192,"98":196}');
