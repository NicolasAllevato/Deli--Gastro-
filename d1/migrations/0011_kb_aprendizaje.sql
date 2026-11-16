-- Aprendizaje del asistente (simulador de clientes, etapa 1b). Nada de esto se aplica solo:
--   * kb_sugerencias: vocabulario / FAQ / etc. propuestos por el simulador. Al aprobarse se copian a kb_negocio.
--   * kb_errores: fallas que detectó el juez. Aprobada = "lección": el bot la recibe en el prompt como
--     "Errores a evitar" (máx. 20, una línea) y el simulador la repite primero como prueba de regresión.
--   `clave` deduplica: la misma falla o sugerencia repetida suma `veces` en vez de crear otra fila.
CREATE TABLE IF NOT EXISTS kb_sugerencias (
  id TEXT PRIMARY KEY,
  clave TEXT NOT NULL UNIQUE,
  origen TEXT NOT NULL DEFAULT 'simulacion' CHECK (origen IN ('simulacion', 'conversacion')),
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada')),
  categoria TEXT NOT NULL CHECK (categoria IN ('faq', 'politica', 'promo', 'vocabulario', 'otro')),
  tema TEXT NOT NULL CHECK (length(tema) BETWEEN 1 AND 120),
  contenido TEXT NOT NULL CHECK (length(contenido) BETWEEN 1 AND 1000),
  evidencia TEXT NOT NULL DEFAULT '' CHECK (length(evidencia) <= 2000),
  veces INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS kb_sugerencias_estado_idx ON kb_sugerencias (estado, updated_at);

CREATE TABLE IF NOT EXISTS kb_errores (
  id TEXT PRIMARY KEY,
  clave TEXT NOT NULL UNIQUE,
  escenario TEXT NOT NULL CHECK (length(escenario) BETWEEN 1 AND 60),
  tipo TEXT NOT NULL CHECK (tipo IN ('precio_inventado', 'no_derivo', 'no_entendio', 'tono_frio', 'no_resolvio', 'otro')),
  mensaje_cliente TEXT NOT NULL CHECK (length(mensaje_cliente) BETWEEN 1 AND 1000),
  respuesta_mala TEXT NOT NULL DEFAULT '' CHECK (length(respuesta_mala) <= 1000),
  motivo TEXT NOT NULL CHECK (length(motivo) BETWEEN 1 AND 500),
  correccion TEXT NOT NULL CHECK (length(correccion) BETWEEN 1 AND 300),
  veces INTEGER NOT NULL DEFAULT 1,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobada', 'rechazada', 'desactivada')),
  -- Resultado de la última prueba de regresión de un error aprobado: 'ok' ya no falla, 'falla' sigue fallando.
  ultima_prueba TEXT CHECK (ultima_prueba IN ('ok', 'falla')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX IF NOT EXISTS kb_errores_estado_idx ON kb_errores (estado, veces DESC);
