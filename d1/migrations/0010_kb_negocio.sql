-- Base de conocimiento del negocio para el asistente de WhatsApp (etapa 1).
-- La edita el admin en /admin/conocimiento. El bot lee solo las filas activas:
--   * categoria 'vocabulario' va al prompt como glosario (cómo hablan los clientes del local);
--   * el resto (faq, politica, promo, otro) lo devuelve la herramienta get_business_info.
CREATE TABLE IF NOT EXISTS kb_negocio (
  id TEXT PRIMARY KEY,
  categoria TEXT NOT NULL CHECK (categoria IN ('faq', 'politica', 'promo', 'vocabulario', 'otro')),
  tema TEXT NOT NULL CHECK (length(tema) BETWEEN 1 AND 120),
  contenido TEXT NOT NULL CHECK (length(contenido) BETWEEN 1 AND 1000),
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  orden INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS kb_negocio_activo_idx ON kb_negocio (activo, categoria, orden);
