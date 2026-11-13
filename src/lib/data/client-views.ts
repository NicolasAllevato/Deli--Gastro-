/**
 * Tanda 3 de la fase 2: lecturas del portal cliente en D1.
 * Todas exigen actor `cliente` y filtran por SU client_id resuelto desde la
 * sesión (JOIN clients ON user_id = actor.userId): nunca un id que mande el
 * navegador. Reproducen las políticas RLS orders_select_own,
 * reviews_select_own y ledger_select_own (G4, G6, G7).
 * Montos en centavos en la base; la vista del cliente sigue en pesos.
 */
import { ForbiddenError, type Actor } from "./actor.ts";
import { fromCents, toCents } from "./money.ts";
import type { SqlDatabase } from "./sql.ts";
import { CLIENT_ORDER_D1_COLUMNS } from "./client-order-fields.ts";

function requireCliente(actor: Actor): string {
  if (actor.kind !== "cliente") throw new ForbiddenError();
  return actor.userId;
}

/**
 * Columnas que ve el cliente de sus pedidos (minimización: sin datos internos
 * de Fudo, geocodificación ni ubicación de entrega del repartidor).
 */
const CLIENT_ORDER_COLS = CLIENT_ORDER_D1_COLUMNS;

interface ClientOrderDbRow {
  id: string;
  status: string;
  items_desc: string;
  total_cents: number;
  delivery_fee_cents: number;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  payment_method: string | null;
  notes: string | null;
  courier_name: string | null;
  channel: string;
  points_earned: number | null;
  created_at: string;
  updated_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export type ClientOrder = Omit<ClientOrderDbRow, "total_cents" | "delivery_fee_cents"> & { total: number; delivery_fee: number };

function toClientOrder(r: ClientOrderDbRow): ClientOrder {
  const { total_cents, delivery_fee_cents, ...rest } = r;
  return { ...rest, total: fromCents(total_cents), delivery_fee: fromCents(delivery_fee_cents) };
}

/** Forma comparable (Supabase en pesos vs D1): solo las columnas de la vista del cliente, sin timestamps. */
export function comparableClientOrder(o: { id: string; [k: string]: unknown }): Record<string, unknown> {
  return {
    id: o.id, status: o.status, items_desc: o.items_desc,
    total_cents: toCents(o.total as number | string), delivery_fee_cents: toCents((o.delivery_fee as number | string | undefined) ?? 0),
    delivery_address: o.delivery_address ?? null, payment_method: o.payment_method ?? null,
    courier_name: o.courier_name ?? null, channel: o.channel, points_earned: o.points_earned ?? null,
  };
}

export async function listOwnOrders(db: SqlDatabase, actor: Actor, limit = 50): Promise<ClientOrder[]> {
  const userId = requireCliente(actor);
  const { results } = await db
    .prepare(`SELECT ${CLIENT_ORDER_COLS} FROM orders o JOIN clients c ON c.id = o.client_id WHERE c.user_id = ? ORDER BY o.created_at DESC LIMIT ?`)
    .bind(userId, Math.min(Math.max(limit, 1), 100))
    .all<ClientOrderDbRow>();
  return results.map(toClientOrder);
}

export async function getOwnOrder(db: SqlDatabase, actor: Actor, orderId: string): Promise<ClientOrder | null> {
  const userId = requireCliente(actor);
  const row = await db
    .prepare(`SELECT ${CLIENT_ORDER_COLS} FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ? AND c.user_id = ?`)
    .bind(orderId, userId)
    .first<ClientOrderDbRow>();
  return row ? toClientOrder(row) : null;
}

/** Ids de pedidos propios ya reseñados (G7). */
export async function listOwnReviewedOrderIds(db: SqlDatabase, actor: Actor): Promise<{ id: string }[]> {
  const userId = requireCliente(actor);
  const { results } = await db
    .prepare("SELECT r.order_id AS id FROM reviews r JOIN clients c ON c.id = r.client_id WHERE c.user_id = ? ORDER BY r.order_id")
    .bind(userId)
    .all<{ id: string }>();
  return results;
}

export interface ClientLedgerEntry {
  id: string;
  delta: number;
  description: string;
  created_at: string;
}

/** Últimos movimientos de puntos propios (G6). */
export async function listOwnLedger(db: SqlDatabase, actor: Actor, limit = 10): Promise<ClientLedgerEntry[]> {
  const userId = requireCliente(actor);
  const { results } = await db
    .prepare(
      "SELECT l.id, l.delta, l.description, l.created_at FROM points_ledger l JOIN clients c ON c.id = l.client_id WHERE c.user_id = ? ORDER BY l.created_at DESC LIMIT ?",
    )
    .bind(userId, Math.min(Math.max(limit, 1), 100))
    .all<ClientLedgerEntry>();
  return results;
}

/** Puntos acreditados por pedido propio (solo asientos positivos con pedido). */
export async function listOwnEarnedByOrder(db: SqlDatabase, actor: Actor): Promise<{ id: string; delta: number }[]> {
  const userId = requireCliente(actor);
  const { results } = await db
    .prepare(
      "SELECT l.order_id AS id, SUM(l.delta) AS delta FROM points_ledger l JOIN clients c ON c.id = l.client_id WHERE c.user_id = ? AND l.delta > 0 AND l.order_id IS NOT NULL GROUP BY l.order_id ORDER BY l.order_id",
    )
    .bind(userId)
    .all<{ id: string; delta: number }>();
  return results;
}
