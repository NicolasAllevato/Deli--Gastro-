-- Carta estructurada (la carta impresa del local): secciones y líneas con nombre de carta, nota y producto(s)
-- vinculados. Solo aditiva. Los PRECIOS NO se guardan acá: salen siempre de `products.price_cents` (Fudo).
-- La usan /api/public/carta.pdf, el editor de /admin/carta y el bot (get_menu / get_categoria).
-- Sin filas, todo sigue con la carta por categorías de antes.
CREATE TABLE IF NOT EXISTS carta_secciones (
  id         TEXT PRIMARY KEY,
  titulo     TEXT NOT NULL CHECK (length(titulo) BETWEEN 1 AND 80),
  orden      INTEGER NOT NULL DEFAULT 0,
  -- JSON: rótulos de las columnas de precio, p. ej. ["8 porciones","Porción"]; [] = una columna sin rótulo.
  columnas   TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(columnas) AND json_type(columnas) = 'array'),
  -- 'gustos': un solo precio para toda la sección (empanadas) y las líneas son los gustos.
  estilo     TEXT NOT NULL DEFAULT 'lista' CHECK (estilo IN ('lista', 'gustos')),
  nota       TEXT CHECK (nota IS NULL OR length(nota) <= 200),
  activo     INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS carta_secciones_orden_idx ON carta_secciones (activo, orden);

CREATE TABLE IF NOT EXISTS carta_items (
  id            TEXT PRIMARY KEY,
  seccion_id    TEXT NOT NULL REFERENCES carta_secciones (id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL CHECK (length(nombre) BETWEEN 1 AND 80),
  nota          TEXT CHECK (nota IS NULL OR length(nota) <= 120),
  orden         INTEGER NOT NULL DEFAULT 0,
  -- Precio de la primera columna (p. ej. la grande). NULL = sin vincular (se muestra sin precio).
  producto_id   TEXT REFERENCES products (id) ON DELETE SET NULL,
  -- Segunda columna (p. ej. la porción). NULL si la sección tiene una sola columna.
  producto_id_2 TEXT REFERENCES products (id) ON DELETE SET NULL,
  activo        INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS carta_items_seccion_idx ON carta_items (seccion_id, orden);
CREATE INDEX IF NOT EXISTS carta_items_producto_idx ON carta_items (producto_id);
CREATE INDEX IF NOT EXISTS carta_items_producto2_idx ON carta_items (producto_id_2);
