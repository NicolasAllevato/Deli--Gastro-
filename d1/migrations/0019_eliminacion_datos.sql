-- 0019: eliminación de datos personales (docs/eliminacion-datos.md). Solo la aplica el dueño, con OK explícito.
--
-- 1) data_deletion_requests: registro de cada pedido de eliminación. NUNCA guarda el dato en claro:
--    subject_hash = sha256 del teléfono (últimos 10 dígitos) o del email normalizado, con prefijo de tipo.
--    counts = JSON { <paso>: <filas> } con cuántos registros se borraron o anonimizaron.
--    status: 'pending' (en curso), 'completed', 'partial' (la base quedó limpia pero algún archivo de R2 no se pudo
--    borrar; `error` lo dice), 'failed' (no se aplicó nada: el lote es atómico).
CREATE TABLE IF NOT EXISTS data_deletion_requests (
  id           TEXT PRIMARY KEY,
  subject_hash TEXT NOT NULL CHECK (length(subject_hash) = 64),
  channel      TEXT NOT NULL CHECK (channel IN ('admin', 'autoservicio', 'email')),
  requested_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  completed_at TEXT,
  performed_by TEXT,
  counts       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(counts)),
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'partial', 'failed')),
  error        TEXT CHECK (error IS NULL OR length(error) <= 2000)
);
CREATE INDEX IF NOT EXISTS data_deletion_requests_requested_idx ON data_deletion_requests (requested_at DESC);
CREATE INDEX IF NOT EXISTS data_deletion_requests_subject_idx ON data_deletion_requests (subject_hash);

-- 2) legal_acceptances: la constancia de aceptación tiene que sobrevivir a la baja de la cuenta, anonimizada.
--    Antes user_id era NOT NULL con ON DELETE CASCADE: borrar al usuario borraba también la constancia.
--    Ahora user_id admite NULL (ON DELETE SET NULL). SQLite no cambia restricciones: se reconstruye la tabla y se
--    copian las filas (mismo patrón que 0016). Ninguna otra tabla referencia legal_acceptances.
CREATE TABLE legal_acceptances_v2 (
  id          TEXT PRIMARY KEY,
  user_id     TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  email       TEXT,
  role        TEXT,
  document    TEXT NOT NULL CHECK (document IN ('terminos','privacidad')),
  version     TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  ip          TEXT,
  user_agent  TEXT,
  UNIQUE (user_id, document, version)
);

INSERT INTO legal_acceptances_v2 (id, user_id, email, role, document, version, accepted_at, ip, user_agent)
SELECT id, user_id, email, role, document, version, accepted_at, ip, user_agent FROM legal_acceptances;

DROP TABLE legal_acceptances;
ALTER TABLE legal_acceptances_v2 RENAME TO legal_acceptances;

CREATE INDEX IF NOT EXISTS legal_acceptances_user_idx     ON legal_acceptances (user_id);
CREATE INDEX IF NOT EXISTS legal_acceptances_accepted_idx ON legal_acceptances (accepted_at DESC);
