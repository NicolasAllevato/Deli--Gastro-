-- Equivalente D1 de supabase/migrations/031_order_items_fudo_detalle.sql.
-- fudo_options: JSON en TEXT ([{qty, name}]).
ALTER TABLE order_items ADD COLUMN fudo_product_id INTEGER;
ALTER TABLE order_items ADD COLUMN fudo_comment TEXT;
ALTER TABLE order_items ADD COLUMN fudo_options TEXT CHECK (fudo_options IS NULL OR json_valid(fudo_options));
ALTER TABLE order_items ADD COLUMN is_combo INTEGER NOT NULL DEFAULT 0 CHECK (is_combo IN (0,1));
CREATE INDEX IF NOT EXISTS order_items_fudo_product_idx ON order_items (fudo_product_id) WHERE fudo_product_id IS NOT NULL;
