-- Aprendizaje desde conversaciones reales (etapa 3). Solo aditiva.
--   * kb_errores.origen: igual que kb_sugerencias, distingue simulación de conversación real (las filas viejas quedan 'simulacion').
--   * kb_analisis_conversaciones: marca de idempotencia del cron nocturno del Worker whatsapp-bot.
--     Una fila por conversación y día (UTC) analizado: la misma conversación no se manda dos veces a OpenAI ese día.
--     No guarda texto ni teléfono: solo el id de la conversación, el resultado y los tokens usados.
ALTER TABLE kb_errores ADD COLUMN origen TEXT NOT NULL DEFAULT 'simulacion' CHECK (origen IN ('simulacion', 'conversacion'));

CREATE TABLE IF NOT EXISTS kb_analisis_conversaciones (
  conversation_id TEXT NOT NULL,
  dia TEXT NOT NULL CHECK (length(dia) = 10),
  resultado TEXT NOT NULL CHECK (resultado IN ('ok', 'invalido', 'vacia')),
  fallas INTEGER NOT NULL DEFAULT 0,
  sugerencias INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (conversation_id, dia)
);
CREATE INDEX IF NOT EXISTS kb_analisis_conversaciones_dia_idx ON kb_analisis_conversaciones (dia);
