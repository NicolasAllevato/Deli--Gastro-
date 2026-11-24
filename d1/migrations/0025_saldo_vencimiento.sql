-- Saldo a favor: vencimiento y tope por reclamo.
--
-- (a) credit_ledger gana `expires_at` (NULL = no vence) y el motivo 'vencido' (descuento de lo no consumido de una
--     acreditación vencida). SQLite no deja cambiar un CHECK, así que se RECONSTRUYE credit_ledger (misma receta que
--     la 0024). Ninguna tabla referencia a credit_ledger, así que el DROP no dispara cascadas: no hace falta respaldo
--     aparte, la copia a credit_ledger_v2 ES el respaldo y se verifica antes de soltar la tabla vieja. Las filas
--     existentes se copian tal cual (expires_at NULL: lo ya acreditado no vence). El DROP elimina también el índice
--     y el trigger viejos; se recrean abajo. La copia no dispara el trigger de suma (está en la tabla vieja),
--     así que clients.credit_cents no cambia.
CREATE TABLE credit_ledger_v2 (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  reclamo_id      TEXT,
  delta_cents     INTEGER NOT NULL CHECK (delta_cents <> 0),
  motivo          TEXT NOT NULL CHECK (motivo IN ('reclamo', 'compra', 'devolucion', 'ajuste', 'vencido')),
  description     TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at      TEXT
);

INSERT INTO credit_ledger_v2 (id, client_id, order_id, reclamo_id, delta_cents, motivo, description, idempotency_key, created_at)
SELECT id, client_id, order_id, reclamo_id, delta_cents, motivo, description, idempotency_key, created_at FROM credit_ledger;

DROP TABLE credit_ledger;
ALTER TABLE credit_ledger_v2 RENAME TO credit_ledger;

CREATE INDEX IF NOT EXISTS credit_ledger_client_idx ON credit_ledger (client_id, created_at);
CREATE INDEX IF NOT EXISTS credit_ledger_order_idx ON credit_ledger (order_id);
CREATE INDEX IF NOT EXISTS credit_ledger_expires_idx ON credit_ledger (expires_at) WHERE expires_at IS NOT NULL;

-- (b) Mismo trigger de suma que la 0024: SIN max(0, ...); el CHECK de clients.credit_cents frena el saldo negativo.
CREATE TRIGGER IF NOT EXISTS credit_ledger_after_insert AFTER INSERT ON credit_ledger
  BEGIN
    UPDATE clients SET credit_cents = credit_cents + NEW.delta_cents WHERE id = NEW.client_id;
  END;

-- (c) Cada acreditación (delta > 0) hereda su vencimiento de la configuración vigente al acreditarla:
--     created_at + `saldo_vencimiento_dias` días (global_config; 0 o ausente = no vence). Se hace en la base para
--     cubrir todos los caminos que acreditan (reclamos, devolución, ajuste manual) sin tocar cada uno.
CREATE TRIGGER IF NOT EXISTS credit_ledger_expires_after_insert AFTER INSERT ON credit_ledger
  WHEN NEW.delta_cents > 0 AND NEW.expires_at IS NULL
   AND COALESCE((SELECT CAST(json_extract(value, '$') AS INTEGER) FROM global_config WHERE key = 'saldo_vencimiento_dias'), 0) > 0
  BEGIN
    UPDATE credit_ledger
       SET expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', NEW.created_at,
             '+' || (SELECT CAST(json_extract(value, '$') AS INTEGER) FROM global_config WHERE key = 'saldo_vencimiento_dias') || ' days')
     WHERE id = NEW.id;
  END;
