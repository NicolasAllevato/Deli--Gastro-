-- Visibilidad de cada producto en el portal del cliente (feat/carta-fudo-visibilidad-fotos).
-- NO aplicar en remoto sin OK del usuario.
--
-- show_in_portal la maneja SOLO el admin (interruptor "Visible en el portal"). El sync de Fudo nunca la
-- escribe: Fudo manda en nombre, precio, disponibilidad (is_active) y categoría.
-- DEFAULT 0: todo producto nuevo (los que entran desde Fudo, los importados) queda oculto hasta que el
-- admin lo active. El portal muestra un producto solo si is_active = 1 AND show_in_portal = 1.
ALTER TABLE products ADD COLUMN show_in_portal INTEGER NOT NULL DEFAULT 0 CHECK (show_in_portal IN (0,1));

-- Los productos que ya existen conservan lo que el cliente ve hoy (antes no había interruptor: todo visible).
UPDATE products SET show_in_portal = 1;

-- Arreglo: el sync de Fudo inserta con ON CONFLICT (fudo_id) (como en Postgres, donde fudo_id es UNIQUE).
-- En D1 products.fudo_id solo tenía un índice común y SQLite rechaza el INSERT ("ON CONFLICT clause does not
-- match any PRIMARY KEY or UNIQUE constraint"): con DATA_BACKEND=d1 no se creaba ningún producto nuevo de Fudo.
-- Antes del índice único se desvinculan duplicados (si los hubiera) dejando el más viejo. Los NULL no chocan.
UPDATE products SET fudo_id = NULL
WHERE fudo_id IS NOT NULL
  AND rowid NOT IN (SELECT MIN(rowid) FROM products WHERE fudo_id IS NOT NULL GROUP BY fudo_id);
CREATE UNIQUE INDEX IF NOT EXISTS products_fudo_id_uidx ON products (fudo_id);
