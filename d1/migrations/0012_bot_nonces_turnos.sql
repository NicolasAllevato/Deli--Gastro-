-- Anti-replay de las llamadas internas bot→app y respuestas del bot sin duplicados (fix/whatsapp-caminos-privacidad).
-- NO aplicar en remoto sin OK del usuario. Solo crea tablas nuevas.

-- Cada nonce firmado se acepta una sola vez; vence a los 120 s (ventana de la firma: ±60 s).
CREATE TABLE IF NOT EXISTS bot_nonces (
  nonce TEXT PRIMARY KEY,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bot_nonces_expires_idx ON bot_nonces (expires_at);

-- Respuestas ya enviadas por turno: un reintento de la cola no repite lo que el cliente ya recibió.
-- turn_key = wamids del turno; seq = orden de la respuesta dentro del turno (0, 1...); 'dlq' marca el aviso de falla.
CREATE TABLE IF NOT EXISTS wa_turn_replies (
  turn_key TEXT NOT NULL,
  seq TEXT NOT NULL,
  wamid TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (turn_key, seq)
);
CREATE INDEX IF NOT EXISTS wa_turn_replies_created_idx ON wa_turn_replies (created_at);
