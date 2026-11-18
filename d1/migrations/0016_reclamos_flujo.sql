-- Flujo completo de reclamos (bot + panel). Reemplaza la tabla de la 0014 conservando sus filas.
-- SQLite no deja cambiar un CHECK (estado suma 'en_curso'): se reconstruye la tabla y se copian los datos.
-- `numero` es el número corto que ve el cliente ("reclamo #12"); a las filas viejas se les asigna por antigüedad.
-- Una sola fila abierta (abierto o en_curso) por conversación: el bot la actualiza en vez de duplicarla.
CREATE TABLE reclamos_v2 (
  id                 TEXT PRIMARY KEY,
  numero             INTEGER NOT NULL UNIQUE CHECK (numero > 0),
  conversation_id    TEXT NOT NULL,
  client_phone       TEXT NOT NULL,
  client_id          TEXT,
  order_id           TEXT,
  categoria          TEXT NOT NULL DEFAULT 'otro'
                       CHECK (categoria IN ('demora', 'llego_frio', 'faltante', 'pedido_equivocado', 'cobro', 'atencion', 'otro')),
  motivo             TEXT NOT NULL CHECK (length(motivo) BETWEEN 1 AND 1000),
  foto_keys          TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(foto_keys) AND json_type(foto_keys) = 'array'),
  estado             TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'en_curso', 'resuelto')),
  resolucion         TEXT CHECK (resolucion IS NULL OR length(resolucion) BETWEEN 1 AND 1000),
  compensacion_tipo  TEXT CHECK (compensacion_tipo IS NULL OR compensacion_tipo IN ('puntos', 'descuento')),
  compensacion_valor INTEGER CHECK (compensacion_valor IS NULL OR compensacion_valor > 0),
  notas              TEXT CHECK (notas IS NULL OR length(notas) <= 4000),
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at        TEXT,
  notified_at        TEXT,
  CHECK ((compensacion_tipo IS NULL) = (compensacion_valor IS NULL))
);

INSERT INTO reclamos_v2 (id, numero, conversation_id, client_phone, client_id, motivo, estado, created_at, updated_at, resolved_at)
SELECT id, row_number() OVER (ORDER BY created_at, id), conversation_id, client_phone, client_id, motivo, estado,
       created_at, coalesce(resolved_at, created_at), resolved_at
FROM reclamos;

DROP TABLE reclamos;
ALTER TABLE reclamos_v2 RENAME TO reclamos;

CREATE INDEX IF NOT EXISTS reclamos_estado_idx ON reclamos (estado, created_at);
CREATE INDEX IF NOT EXISTS reclamos_conversation_idx ON reclamos (conversation_id);
CREATE INDEX IF NOT EXISTS reclamos_categoria_idx ON reclamos (categoria, created_at);
-- Garantía en la base de "un reclamo abierto por conversación" (el bot igual lo chequea antes).
CREATE UNIQUE INDEX IF NOT EXISTS reclamos_abierto_por_conversacion ON reclamos (conversation_id) WHERE estado <> 'resuelto';

-- Historial: cambios de estado, notas, mensajes al cliente, fotos y avisos al local.
CREATE TABLE IF NOT EXISTS reclamos_eventos (
  id          TEXT PRIMARY KEY,
  reclamo_id  TEXT NOT NULL REFERENCES reclamos(id) ON DELETE CASCADE,
  tipo        TEXT NOT NULL CHECK (tipo IN ('creado', 'actualizado', 'foto', 'estado', 'nota', 'mensaje', 'compensacion', 'notificado')),
  detalle     TEXT NOT NULL DEFAULT '' CHECK (length(detalle) <= 2000),
  autor       TEXT NOT NULL DEFAULT 'sistema' CHECK (autor IN ('bot', 'admin', 'sistema')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS reclamos_eventos_reclamo_idx ON reclamos_eventos (reclamo_id, created_at);
