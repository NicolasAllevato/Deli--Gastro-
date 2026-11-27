-- Vínculos entre los productos de la app y la carta del sitio web de la pizzería (Etapa 1 de la integración).
--
-- Cada fila une un producto de la app (sincronizado desde Fudo) con un producto del sitio (y su variante, p. ej.
-- «Entera» / «Porción») o con una promoción del sitio. Varios productos de la app pueden apuntar al mismo producto del
-- sitio, cada uno con su variante: «Grande de muzzarella» y «Porcion Muzzarella» van a «Muzzarella».
--   kind            'product' | 'promotion'
--   site_id         uuid del producto o de la promoción en el sitio
--   site_variant_id uuid de la variante (NULL en promociones o en productos sin variante)
--   linked_by       quién confirmó el vínculo (id del usuario admin)
--   last_pushed_at / last_push_error  los usa la Etapa 2 (publicar precios y productos al sitio); acá quedan en NULL.
-- Si se borra el producto de la app, se borra su vínculo (ON DELETE CASCADE). El sitio no se toca desde esta tabla.
CREATE TABLE IF NOT EXISTS site_links (
  app_product_id  TEXT PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  kind            TEXT NOT NULL CHECK (kind IN ('product', 'promotion')),
  site_id         TEXT NOT NULL,
  site_variant_id TEXT,
  linked_by       TEXT,
  linked_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_pushed_at  TEXT,
  last_push_error TEXT
);
CREATE INDEX IF NOT EXISTS site_links_site_idx ON site_links (site_id);
