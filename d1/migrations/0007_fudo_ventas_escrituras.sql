-- Ventas en Fudo al confirmar un pedido de la app o de WhatsApp (feat/fudo-ventas).
-- NO aplicar en remoto sin OK del usuario.
--
-- fudo_sale_id: venta creada en Fudo para este pedido. UNIQUE: nunca dos pedidos con la misma venta.
-- fudo_sale_sync: 'sending' (tomado por un proceso; evita dos ventas para un pedido),
--   'sent', 'partial' (alguna línea falló: revisar en Fudo), 'pending' (falló o escrituras apagadas:
--   reintento desde el admin). NULL = nunca se intentó.
ALTER TABLE orders ADD COLUMN fudo_sale_id INTEGER;
ALTER TABLE orders ADD COLUMN fudo_sale_sync TEXT CHECK (fudo_sale_sync IS NULL OR fudo_sale_sync IN ('sending','sent','partial','pending'));
ALTER TABLE orders ADD COLUMN fudo_sale_error TEXT;
ALTER TABLE orders ADD COLUMN fudo_sale_claimed_at TEXT;
ALTER TABLE orders ADD COLUMN fudo_sale_paid_at TEXT;
ALTER TABLE orders ADD COLUMN fudo_sale_closed_at TEXT;
ALTER TABLE orders ADD COLUMN fudo_sale_canceled_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS orders_fudo_sale_id_uidx ON orders (fudo_sale_id) WHERE fudo_sale_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_fudo_sale_pending_idx ON orders (created_at DESC) WHERE fudo_sale_sync IN ('pending','partial','sending');

-- Auditoría de cada escritura hacia Fudo (éxito y fallo). Solo la escribe el servidor.
CREATE TABLE IF NOT EXISTS fudo_writes (
  id          TEXT PRIMARY KEY,
  order_id    TEXT REFERENCES orders(id) ON DELETE SET NULL,
  operation   TEXT NOT NULL CHECK (operation IN ('create_sale','close_sale','cancel_sale','payment')),
  fudo_id     INTEGER,
  ok          INTEGER NOT NULL CHECK (ok IN (0,1)),
  http_status INTEGER,
  error       TEXT CHECK (error IS NULL OR length(error) <= 500),
  payload     TEXT CHECK (payload IS NULL OR (json_valid(payload) AND length(payload) <= 20000)),
  actor       TEXT NOT NULL CHECK (length(actor) BETWEEN 1 AND 120),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS fudo_writes_order_idx ON fudo_writes (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS fudo_writes_created_idx ON fudo_writes (created_at DESC);
