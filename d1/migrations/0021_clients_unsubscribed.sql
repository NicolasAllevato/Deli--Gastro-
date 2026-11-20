-- 0021: baja de comunicaciones de un cliente que dio de baja su cuenta (docs/eliminacion-datos.md).
-- clients.unsubscribed_at: fecha de la baja (NULL = recibe comunicaciones). Lo escribe SOLO el servidor al dar de baja la cuenta.
-- Con la baja la ficha NO se borra (queda el historial de pedidos, puntos, reseñas y conversaciones) pero deja de recibir:
--   * promociones por WhatsApp (campañas),
--   * encuestas de satisfacción por WhatsApp,
--   * cualquier envío que no responda a algo que el propio cliente inicie.
-- wa_marketing_opt_in sigue siendo el opt-in a promociones (ALTA/BAJA por WhatsApp); unsubscribed_at es un freno que se suma:
-- aunque el opt-in esté en 1, con unsubscribed_at no se manda nada promocional. Escribir ALTA por WhatsApp (consentimiento
-- explícito del propio cliente) vuelve a dejar unsubscribed_at en NULL.
-- NO aplicar en remoto sin OK del usuario.
ALTER TABLE clients ADD COLUMN unsubscribed_at TEXT;
-- Parcial: casi todas las fichas tienen NULL; el índice solo sirve para listar las dadas de baja.
CREATE INDEX IF NOT EXISTS clients_unsubscribed_idx ON clients (unsubscribed_at) WHERE unsubscribed_at IS NOT NULL;
