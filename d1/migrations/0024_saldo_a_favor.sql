-- Saldo a favor: crédito en pesos del cliente (en centavos, como el resto de los montos).
-- Se otorga al resolver un reclamo (motivo 'reclamo') y se descuenta en la próxima compra ('compra');
-- si el pedido se cancela se devuelve ('devolucion'). Es un saldo APARTE de los puntos de fidelidad.

-- (a) Saldo del cliente y monto de saldo aplicado en cada pedido (ya incluido dentro de total_cents).
ALTER TABLE clients ADD COLUMN credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0);
ALTER TABLE orders ADD COLUMN credit_applied_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_applied_cents >= 0);

-- (b) Libro de movimientos. La idempotency_key es obligatoria y única: repetir el mismo hecho no suma dos veces.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id              TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  order_id        TEXT REFERENCES orders(id) ON DELETE SET NULL,
  reclamo_id      TEXT,
  delta_cents     INTEGER NOT NULL CHECK (delta_cents <> 0),
  motivo          TEXT NOT NULL CHECK (motivo IN ('reclamo', 'compra', 'devolucion', 'ajuste')),
  description     TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS credit_ledger_client_idx ON credit_ledger (client_id, created_at);
CREATE INDEX IF NOT EXISTS credit_ledger_order_idx ON credit_ledger (order_id);

-- Igual que points_ledger: SIN max(0, ...). Si un débito deja el saldo negativo, el CHECK de
-- clients.credit_cents falla y el INSERT del ledger se revierte (y, dentro de un batch, todo el batch):
-- dos compras concurrentes no pueden gastar el mismo saldo dos veces.
CREATE TRIGGER IF NOT EXISTS credit_ledger_after_insert AFTER INSERT ON credit_ledger
  BEGIN
    UPDATE clients SET credit_cents = credit_cents + NEW.delta_cents WHERE id = NEW.client_id;
  END;

-- (c) reclamos acepta compensacion_tipo = 'saldo' (se mantiene 'descuento' por los datos viejos).
-- SQLite no deja cambiar un CHECK: se reconstruye la tabla (misma receta que la 0016).
--
-- DECISIÓN sobre reclamos_eventos: tiene FK ON DELETE CASCADE hacia reclamos y D1 no permite
-- PRAGMA foreign_keys = OFF dentro de una migración. Con las FK activas, DROP TABLE reclamos hace
-- un DELETE implícito y el CASCADE borraría todo el historial. Por eso se respalda reclamos_eventos
-- en una tabla común ANTES del DROP y se restaura DESPUÉS del RENAME (cuando la tabla padre ya
-- existe de nuevo con los mismos ids), y se elimina el respaldo. No se usa defer_foreign_keys: solo
-- difiere el chequeo, no las acciones en cascada.
CREATE TABLE _reclamos_eventos_bak AS SELECT * FROM reclamos_eventos;

CREATE TABLE reclamos_v3 (
  id                  TEXT PRIMARY KEY,
  numero              INTEGER NOT NULL UNIQUE CHECK (numero > 0),
  conversation_id     TEXT NOT NULL,
  client_phone        TEXT NOT NULL,
  client_id           TEXT,
  order_id            TEXT,
  categoria           TEXT NOT NULL DEFAULT 'otro'
                        CHECK (categoria IN ('demora', 'llego_frio', 'faltante', 'pedido_equivocado', 'cobro', 'atencion', 'otro')),
  motivo              TEXT NOT NULL CHECK (length(motivo) BETWEEN 1 AND 1000),
  foto_keys           TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(foto_keys) AND json_type(foto_keys) = 'array'),
  estado              TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_curso', 'resuelto')),
  resolucion          TEXT CHECK (resolucion IS NULL OR length(resolucion) BETWEEN 1 AND 1000),
  compensacion_tipo   TEXT CHECK (compensacion_tipo IS NULL OR compensacion_tipo IN ('puntos', 'descuento', 'saldo')),
  compensacion_valor  INTEGER CHECK (compensacion_valor IS NULL OR compensacion_valor > 0),
  notas               TEXT CHECK (notas IS NULL OR length(notas) <= 4000),
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at         TEXT,
  notified_at         TEXT,
  sugerencia          TEXT CHECK (sugerencia IS NULL OR json_valid(sugerencia)),
  sugerencia_at       TEXT,
  sugerencia_error    TEXT CHECK (sugerencia_error IS NULL OR length(sugerencia_error) <= 300),
  mensaje_resolucion  TEXT CHECK (mensaje_resolucion IS NULL OR length(mensaje_resolucion) <= 1000),
  notificacion_estado TEXT CHECK (notificacion_estado IS NULL OR notificacion_estado IN ('enviado', 'fallo')),
  notificacion_error  TEXT CHECK (notificacion_error IS NULL OR length(notificacion_error) <= 300),
  CHECK ((compensacion_tipo IS NULL) = (compensacion_valor IS NULL))
);

INSERT INTO reclamos_v3 (
  id, numero, conversation_id, client_phone, client_id, order_id, categoria, motivo, foto_keys, estado, resolucion,
  compensacion_tipo, compensacion_valor, notas, created_at, updated_at, resolved_at, notified_at,
  sugerencia, sugerencia_at, sugerencia_error, mensaje_resolucion, notificacion_estado, notificacion_error
)
SELECT
  id, numero, conversation_id, client_phone, client_id, order_id, categoria, motivo, foto_keys, estado, resolucion,
  compensacion_tipo, compensacion_valor, notas, created_at, updated_at, resolved_at, notified_at,
  sugerencia, sugerencia_at, sugerencia_error, mensaje_resolucion, notificacion_estado, notificacion_error
FROM reclamos;

DROP TABLE reclamos;
ALTER TABLE reclamos_v3 RENAME TO reclamos;

CREATE INDEX IF NOT EXISTS reclamos_estado_idx ON reclamos (estado, created_at);
CREATE INDEX IF NOT EXISTS reclamos_conversation_idx ON reclamos (conversation_id);
CREATE INDEX IF NOT EXISTS reclamos_categoria_idx ON reclamos (categoria, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS reclamos_abierto_por_conversacion ON reclamos (conversation_id) WHERE estado <> 'resuelto';

-- Restaura el historial (el CASCADE lo vació al soltar la tabla vieja) y quita el respaldo.
INSERT OR IGNORE INTO reclamos_eventos SELECT * FROM _reclamos_eventos_bak;
DROP TABLE _reclamos_eventos_bak;
