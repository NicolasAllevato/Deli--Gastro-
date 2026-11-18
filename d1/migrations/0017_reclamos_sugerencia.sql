-- Agente de reclamos: sugerencia de resolución (IA) y estado del aviso de resolución al cliente. Solo aditiva.
-- sugerencia: JSON validado por la app ({diagnostico, resolucion: {tipo, valor, motivo}, mensaje}); null = sin sugerencia.
-- mensaje_resolucion: el texto (editado) que se le mandó o se le intentó mandar al cliente al resolver.
-- notificacion_estado: 'enviado' | 'fallo' (fuera de la ventana de 24 h, sin conexión…); el panel ofrece reintentar.
ALTER TABLE reclamos ADD COLUMN sugerencia TEXT CHECK (sugerencia IS NULL OR json_valid(sugerencia));
ALTER TABLE reclamos ADD COLUMN sugerencia_at TEXT;
ALTER TABLE reclamos ADD COLUMN sugerencia_error TEXT CHECK (sugerencia_error IS NULL OR length(sugerencia_error) <= 300);
ALTER TABLE reclamos ADD COLUMN mensaje_resolucion TEXT CHECK (mensaje_resolucion IS NULL OR length(mensaje_resolucion) <= 1000);
ALTER TABLE reclamos ADD COLUMN notificacion_estado TEXT CHECK (notificacion_estado IS NULL OR notificacion_estado IN ('enviado', 'fallo'));
ALTER TABLE reclamos ADD COLUMN notificacion_error TEXT CHECK (notificacion_error IS NULL OR length(notificacion_error) <= 300);
