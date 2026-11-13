-- Equivalente D1 de supabase/migrations/031_order_items_fudo_detalle.sql.
-- fudo_options: JSON en TEXT ([{qty, name}]).
ALTER TABLE order_items ADD COLUMN fudo_product_id INTEGER;
ALTER TABLE order_items ADD COLUMN fudo_comment TEXT;
ALTER TABLE order_items ADD COLUMN fudo_options TEXT CHECK (fudo_options IS NULL OR json_valid(fudo_options));
CREATE INDEX IF NOT EXISTS order_items_fudo_product_idx ON order_items (fudo_product_id) WHERE fudo_product_id IS NOT NULL;
