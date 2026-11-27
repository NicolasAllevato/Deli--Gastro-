-- Etapa 2 de la integración con el sitio web: publicar precios, estado y fotos de la app al sitio.
--
--   site_links.pushed_image_url  última foto de la app que se mandó al sitio (o que se trajo del sitio a la app). Sirve
--                                para no volver a subir la misma foto en cada corrida.
--   site_publish_runs            historial de corridas (manual, cada 15 min o por un cambio en la app).
--                                summary = JSON corto con contadores y errores; nunca lleva secretos.
ALTER TABLE site_links ADD COLUMN pushed_image_url TEXT;

CREATE TABLE IF NOT EXISTS site_publish_runs (
  id          TEXT PRIMARY KEY,
  trigger     TEXT NOT NULL CHECK (trigger IN ('manual', 'cron', 'cambio')),
  started_at  TEXT NOT NULL,
  finished_at TEXT,
  ok          INTEGER,
  summary     TEXT
);
CREATE INDEX IF NOT EXISTS site_publish_runs_started_idx ON site_publish_runs (started_at DESC);
