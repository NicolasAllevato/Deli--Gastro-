/**
 * Inventario de datos personales en D1: qué tabla/columna guarda datos de una persona y qué se hace con ella al
 * eliminar sus datos. Es la fuente de la lista de docs/eliminacion-datos.md y de las pruebas:
 * - tests/data-deletion.test.ts exige que TODA tabla del esquema figure acá (una tabla nueva sin clasificar rompe la
 *   prueba) y que, tras eliminar, ninguna de las columnas de `personal` conserve el dato original.
 * - Los pasos que ejecutan el borrado (DELETION_STEPS en data-deletion.ts) tienen que cubrir cada tabla "delete" y
 *   "anonymize" de acá.
 *
 * action:
 *   delete     se borran las filas de la persona.
 *   anonymize  la fila se conserva (por obligación contable o porque no es solo de la persona) y se vacían las columnas
 *              de `personal`.
 *   keep       tiene datos de una persona pero no se pueden vincular a ella o son de configuración del local: no se tocan
 *              (la razón está en `note`).
 *   none       sin datos personales.
 */
export type InventoryAction = "delete" | "anonymize" | "keep" | "none";

export interface InventoryEntry {
  table: string;
  action: InventoryAction;
  /** Columnas con datos personales de esa tabla. */
  personal: readonly string[];
  note: string;
}

export const DATA_INVENTORY: readonly InventoryEntry[] = [
  // Autenticación (Better Auth)
  { table: "user", action: "delete", personal: ["name", "email", "image", "phone"], note: "Cuenta. Se borra la fila (la baja cascada a sesiones, cuentas y ubicaciones)." },
  { table: "session", action: "delete", personal: ["ipAddress", "userAgent", "token"], note: "Sesiones abiertas: IP, navegador y token." },
  { table: "account", action: "delete", personal: ["accountId", "accessToken", "refreshToken", "idToken", "password"], note: "Credenciales: hash de la contraseña y tokens." },
  { table: "verification", action: "delete", personal: ["identifier", "value"], note: "Tokens de recuperación y verificación (identifier = email; value = id de usuario)." },
  { table: "rateLimit", action: "keep", personal: ["key"], note: "Clave = IP + ruta, sin vínculo con una persona; se renueva por ventana de tiempo." },
  { table: "courier_pin_attempts", action: "keep", personal: ["key"], note: "Intentos de PIN por IP/dispositivo, sin vínculo con una persona (la clave de la baja desde la cuenta se limpia al terminar)." },

  // Clientes y fidelidad
  { table: "clients", action: "delete", personal: ["name", "phone", "phone_digits", "address", "email"], note: "Ficha del cliente. Los clientes anónimos por canal (PedidosYa, Rappi, etc.) no son una persona y no se tocan." },
  { table: "points_ledger", action: "delete", personal: ["description"], note: "Movimientos de puntos del cliente." },
  { table: "reviews", action: "delete", personal: ["feedback"], note: "Reseñas del cliente." },
  { table: "payment_intents", action: "delete", personal: ["snapshot", "checkout_url", "mp_preference_id", "mp_payment_id"], note: "Intenciones de pago: el carrito con dirección y notas. El pago real queda en Mercado Pago; el pedido conserva monto y medio de pago." },

  // Pedidos
  { table: "orders", action: "anonymize", personal: ["customer_name", "delivery_address", "delivery_lat", "delivery_lng", "delivered_lat", "delivered_lng", "delivered_accuracy_m", "notes", "courier_name"], note: "Se conservan id, fechas, montos, medio de pago y estado (obligación contable). Se desvincula del cliente y de los datos de entrega. Si la persona es repartidor, también se anonimiza courier_name." },
  { table: "order_items", action: "anonymize", personal: ["fudo_comment"], note: "Se conservan producto, cantidad y precio; se borra el comentario libre de la línea." },
  { table: "order_events", action: "anonymize", personal: ["detail"], note: "Bitácora del pedido. Solo el evento 'assigned' lleva el nombre del repartidor en `detail`; el resto no lleva datos personales." },
  { table: "fudo_writes", action: "anonymize", personal: ["payload", "actor"], note: "Auditoría de ventas enviadas a Fudo: el payload lleva nombre, teléfono, dirección y comentario del cliente; actor lleva el id de usuario." },

  // Repartidores
  { table: "couriers", action: "delete", personal: ["name", "pin_hash", "pin_encrypted"], note: "Ficha del repartidor." },
  { table: "courier_locations", action: "delete", personal: ["courier_name", "lat", "lng", "accuracy_m", "heading", "speed_mps"], note: "Última ubicación del repartidor." },
  { table: "courier_shifts", action: "delete", personal: ["courier_name"], note: "Habilitaciones diarias del repartidor." },

  // Constancias legales
  { table: "legal_acceptances", action: "anonymize", personal: ["user_id", "email", "ip", "user_agent"], note: "Se conserva la constancia (documento, versión, fecha y rol) sin usuario, email, IP ni navegador." },

  // WhatsApp
  { table: "wa_conversations", action: "delete", personal: ["client_phone", "contact_name", "state"], note: "Conversación: teléfono, nombre del perfil y estado del borrador de pedido (dirección, nombre)." },
  { table: "wa_messages", action: "delete", personal: ["body"], note: "Mensajes enviados y recibidos, incluidos los audios transcriptos y las ubicaciones. Los audios no se guardan como archivo: solo la transcripción." },
  { table: "wa_turn_replies", action: "keep", personal: [], note: "Solo ids de mensajes (wamid) para no repetir respuestas; sin teléfono ni texto." },
  { table: "wa_campaigns", action: "none", personal: [], note: "Filtros y texto de la campaña; no guarda destinatarios." },
  { table: "bot_nonces", action: "none", personal: [], note: "Anti-replay del bot; vence a los 120 s." },
  { table: "kb_analisis_conversaciones", action: "delete", personal: ["conversation_id"], note: "Marca de qué conversaciones analizó el aprendizaje nocturno (solo el id de la conversación)." },
  { table: "kb_errores", action: "keep", personal: ["mensaje_cliente", "respuesta_mala"], note: "Fallas del bot detectadas en conversaciones reales. El Worker enmascara teléfonos, emails, direcciones y nombres antes de guardarlas (maskTranscriptPii) y no guarda vínculo con la conversación, así que no se pueden asociar a una persona." },
  { table: "kb_sugerencias", action: "keep", personal: ["evidencia"], note: "Igual que kb_errores: texto enmascarado y sin vínculo con la conversación." },
  { table: "kb_negocio", action: "none", personal: [], note: "Conocimiento del negocio cargado por el local." },

  // Reclamos
  { table: "reclamos", action: "anonymize", personal: ["client_phone", "client_id", "conversation_id", "motivo", "foto_keys", "notas", "resolucion", "mensaje_resolucion", "sugerencia", "sugerencia_error", "notificacion_error"], note: "Se conservan número, categoría, estado, pedido y compensación; se vacían teléfono, motivo, notas, textos y las referencias a las fotos (los archivos se borran de R2)." },
  { table: "reclamos_eventos", action: "anonymize", personal: ["detalle"], note: "Historial del reclamo: se conserva el tipo, el autor y la fecha; se vacía el texto." },

  // Configuración del local (sin datos de clientes)
  { table: "integration_settings", action: "anonymize", personal: ["updated_by"], note: "Credenciales y ajustes del local, cifrados. Solo se limpia `updated_by` (id del usuario del panel que los cambió). Incluye quién conectó WhatsApp (nombre/email de Facebook): dato del personal, ver docs." },
  { table: "global_config", action: "keep", personal: [], note: "Configuración del local. Los destinatarios del resumen diario (nombre, email, teléfono del personal) y la lista de teléfonos de prueba del bot los edita el dueño: no se tocan automáticamente." },
  { table: "data_deletion_requests", action: "keep", personal: [], note: "Registro de los pedidos de eliminación: solo hash del teléfono/email, nunca el dato en claro." },

  // Catálogo, zonas y reportes (sin datos personales)
  { table: "categories", action: "none", personal: [], note: "Catálogo." },
  { table: "products", action: "none", personal: [], note: "Catálogo." },
  { table: "carta_secciones", action: "none", personal: [], note: "Carta." },
  { table: "carta_items", action: "none", personal: [], note: "Carta." },
  { table: "delivery_zones", action: "none", personal: [], note: "Zonas de entrega." },
  { table: "reports_daily", action: "none", personal: [], note: "Totales agregados por día." },
  { table: "fudo_product_map", action: "none", personal: [], note: "Mapeo de productos a Fudo." },
  { table: "fudo_payment_map", action: "none", personal: [], note: "Mapeo de medios de pago a Fudo." },
  { table: "fudo_sync_runs", action: "none", personal: [], note: "Corridas de sincronización (contadores)." },
  { table: "live_versions", action: "none", personal: [], note: "Contadores de versión para refrescar pantallas." },
  { table: "_migracion", action: "none", personal: [], note: "Marcas de la migración desde Supabase." },
];

/** Placeholder que reemplaza a los textos obligatorios (NOT NULL) que se anonimizan. */
export const ERASED = "Eliminado";
