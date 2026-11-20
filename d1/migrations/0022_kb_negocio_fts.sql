-- 0022: índice de búsqueda de la base de conocimiento (kb_negocio) para el asistente de WhatsApp.
-- Antes el bot leía las primeras 80 filas ordenadas por categoría (cortaba en silencio lo que no entraba). Ahora
-- get_business_info recibe lo que el cliente pregunta y devuelve solo las entradas relevantes (FTS5, ranking bm25).
--   * kb_negocio.palabras_clave: sinónimos / formas de decirlo ("abren, cierran, hora"), opcional, hasta 300 caracteres.
--   * kb_negocio_fts: tabla FTS5 propia (con su copia del texto) sobre tema, contenido y palabras_clave, sin tildes ni
--     mayúsculas. NO usa content='kb_negocio': el id de kb_negocio es TEXT (sin rowid estable ante un VACUUM), así que
--     la tabla guarda el id como columna UNINDEXED y los triggers la mantienen sincronizada. Son pocas filas (tope 300).
--   * Al final se carga con las filas que ya existen.
-- Es solo aditiva: el bot que todavía no la usa sigue funcionando. El ALTER no es repetible (como el de la 0021).
-- NO aplicar en remoto sin OK del usuario. OJO: `wrangler d1 export` no soporta tablas virtuales (ver docs/migracion-supabase-d1.md).
ALTER TABLE kb_negocio ADD COLUMN palabras_clave TEXT NOT NULL DEFAULT '' CHECK (length(palabras_clave) <= 300);

CREATE VIRTUAL TABLE IF NOT EXISTS kb_negocio_fts USING fts5(
  id UNINDEXED,
  tema,
  contenido,
  palabras_clave,
  tokenize = "unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS kb_negocio_fts_ai AFTER INSERT ON kb_negocio BEGIN
  INSERT INTO kb_negocio_fts (id, tema, contenido, palabras_clave) VALUES (new.id, new.tema, new.contenido, new.palabras_clave);
END;

CREATE TRIGGER IF NOT EXISTS kb_negocio_fts_ad AFTER DELETE ON kb_negocio BEGIN
  DELETE FROM kb_negocio_fts WHERE id = old.id;
END;

-- Solo cuando cambia algo que se indexa (activar/desactivar o el orden no reindexan: el filtro va por JOIN).
CREATE TRIGGER IF NOT EXISTS kb_negocio_fts_au AFTER UPDATE OF id, tema, contenido, palabras_clave ON kb_negocio BEGIN
  DELETE FROM kb_negocio_fts WHERE id = old.id;
  INSERT INTO kb_negocio_fts (id, tema, contenido, palabras_clave) VALUES (new.id, new.tema, new.contenido, new.palabras_clave);
END;

DELETE FROM kb_negocio_fts;
INSERT INTO kb_negocio_fts (id, tema, contenido, palabras_clave) SELECT id, tema, contenido, palabras_clave FROM kb_negocio;
