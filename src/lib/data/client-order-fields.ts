/**
 * Campos de un pedido que la API y las pantallas del cliente reciben.
 * ÚNICA lista para Supabase y D1 (fase 2, tanda 4). Inventario en el PR:
 * se quedan los que usa alguna pantalla y, ante la duda, los que no son
 * internos. Salen solo los internos que ninguna pantalla del cliente usa.
 * Es un recorte de lo que se DEVUELVE: los datos de las bases no cambian.
 * tests/client-order-fields.test.ts falla si una pantalla pide un campo que no está acá.
 */
export const CLIENT_ORDER_FIELDS = [
  "id",
  "status",
  "items_desc",
  "total",
  "delivery_fee",
  "delivery_address",
  "delivery_lat",
  "delivery_lng",
  "payment_method",
  "notes",
  "courier_name",
  "channel",
  "points_earned",
  "created_at",
  "updated_at",
  "accepted_at",
  "ready_at",
  "picked_up_at",
  "delivered_at",
] as const;

export type ClientOrderField = (typeof CLIENT_ORDER_FIELDS)[number];

/**
 * Internos que se dejan de devolver al cliente (siguen en la base, sin cambios).
 * courier_user_id y payment_intent_id existen solo en D1.
 */
export const CLIENT_ORDER_EXCLUDED = [
  "client_id",
  "courier_user_id",
  "payment_intent_id",
  "survey_sent_at",
  "customer_name",
  "fudo_order_id",
  "fudo_sync_status",
  "fudo_sale_type",
  "fudo_sale_state",
  "fudo_source",
  "fudo_payment",
  "fudo_payments",
  "fudo_error",
  "fudo_attempts",
  "fudo_synced_at",
  "delivered_lat",
  "delivered_lng",
  "delivered_accuracy_m",
  "delivered_in_app",
  "geocode_attempts",
] as const;

/** Columnas de Supabase (montos en pesos): mismos nombres que la API. */
export const CLIENT_ORDER_SELECT = CLIENT_ORDER_FIELDS.join(", ");

/** Columnas de D1: los montos viven en centavos; el resto con el mismo nombre. */
const D1_NAME: Partial<Record<ClientOrderField, string>> = { total: "total_cents", delivery_fee: "delivery_fee_cents" };
export const CLIENT_ORDER_D1_COLUMNS = CLIENT_ORDER_FIELDS.map((f) => `o.${D1_NAME[f] ?? f}`).join(", ");
