-- Tickets de reclamo del bot de WhatsApp. Solo aditiva.
-- Fuera de horario no hay nadie en el local: ante una queja o un pedido de hablar con una persona, el bot NO
-- deriva (no pone human_takeover) sino que deja un ticket abierto; el local lo ve en /admin/conocimiento y
-- contacta al cliente cuando abre. Dentro de horario la queja sigue derivando a una persona como siempre.
CREATE TABLE IF NOT EXISTS reclamos (
  id              TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  client_phone    TEXT NOT NULL,
  client_id       TEXT,
  motivo          TEXT NOT NULL CHECK (length(motivo) BETWEEN 1 AND 500),
  estado          TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'resuelto')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  resolved_at     TEXT
);
CREATE INDEX IF NOT EXISTS reclamos_estado_idx ON reclamos (estado, created_at);
CREATE INDEX IF NOT EXISTS reclamos_conversation_idx ON reclamos (conversation_id);
