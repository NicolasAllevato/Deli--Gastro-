import { ForbiddenError, isStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export interface OrderRow {
  id: string;
  client_id: string | null;
  status: string;
  items_desc: string;
  total_cents: number;
  delivery_fee_cents: number;
  delivery_address: string | null;
  courier_name: string | null;
  courier_user_id: string | null;
  created_at: string;
}

export interface OrderItemRow {
  id: string;
  order_id: string;
  product_id: string | null;
  name: string;
  qty: number;
  unit_price_cents: number;
}

const COLS =
  "o.id, o.client_id, o.status, o.items_desc, o.total_cents, o.delivery_fee_cents, o.delivery_address, o.courier_name, o.courier_user_id, o.created_at";

/** Pedidos que el repartidor puede ver: asignados a él o libres y listos para tomar. */
const COURIER_SCOPE =
  "(o.courier_user_id = ? OR (o.courier_user_id IS NULL AND o.status IN ('En Preparación','En Camino')))";

/** G4/G13: lista según rol. Cliente: solo sus pedidos. Repartidor: los suyos y los libres. */
export async function listOrders(db: SqlDatabase, actor: Actor, limit = 50): Promise<OrderRow[]> {
  const lim = Math.min(Math.max(limit, 1), 200);
  if (isStaff(actor)) {
    return (await db.prepare(`SELECT ${COLS} FROM orders o ORDER BY o.created_at DESC LIMIT ?`).bind(lim).all<OrderRow>()).results;
  }
  if (actor.kind === "cliente") {
    return (
      await db
        .prepare(`SELECT ${COLS} FROM orders o JOIN clients c ON c.id = o.client_id WHERE c.user_id = ? ORDER BY o.created_at DESC LIMIT ?`)
        .bind(actor.userId, lim)
        .all<OrderRow>()
    ).results;
  }
  if (actor.kind === "repartidor") {
    return (
      await db
        .prepare(`SELECT ${COLS} FROM orders o WHERE ${COURIER_SCOPE} ORDER BY o.created_at DESC LIMIT ?`)
        .bind(actor.userId, lim)
        .all<OrderRow>()
    ).results;
  }
  throw new ForbiddenError();
}

export async function getOrder(db: SqlDatabase, actor: Actor, orderId: string): Promise<OrderRow | null> {
  if (isStaff(actor)) {
    return db.prepare(`SELECT ${COLS} FROM orders o WHERE o.id = ?`).bind(orderId).first<OrderRow>();
  }
  if (actor.kind === "cliente") {
    return db
      .prepare(`SELECT ${COLS} FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ? AND c.user_id = ?`)
      .bind(orderId, actor.userId)
      .first<OrderRow>();
  }
  if (actor.kind === "repartidor") {
    return db.prepare(`SELECT ${COLS} FROM orders o WHERE o.id = ? AND ${COURIER_SCOPE}`).bind(orderId, actor.userId).first<OrderRow>();
  }
  throw new ForbiddenError();
}

/** G5: items solo de pedidos propios. */
export async function listOrderItems(db: SqlDatabase, actor: Actor, orderId: string): Promise<OrderItemRow[]> {
  const order = await getOrder(db, actor, orderId);
  if (!order) return [];
  const { results } = await db
    .prepare("SELECT id, order_id, product_id, name, qty, unit_price_cents FROM order_items WHERE order_id = ? ORDER BY created_at")
    .bind(orderId)
    .all<OrderItemRow>();
  return results;
}

/** Estados que el staff puede fijar. El cliente nunca escribe pedidos directo (G4). */
export const ORDER_STATUSES = ["Recibidos", "En Preparación", "En Camino", "Finalizados", "Cancelado"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export async function setOrderStatus(db: SqlDatabase, actor: Actor, orderId: string, status: OrderStatus): Promise<boolean> {
  if (!ORDER_STATUSES.includes(status)) throw new Error("Estado inválido");
  if (isStaff(actor)) {
    const r = await db.prepare("UPDATE orders SET status = ?, updated_at = ? WHERE id = ?").bind(status, nowIso(), orderId).run();
    return r.meta.changes === 1;
  }
  if (actor.kind === "repartidor") {
    // G13: solo entrega pedidos asignados a él.
    if (status !== "Finalizados") throw new ForbiddenError();
    const r = await db
      .prepare("UPDATE orders SET status = 'Finalizados', delivered_at = ?, updated_at = ? WHERE id = ? AND courier_user_id = ? AND status = 'En Camino'")
      .bind(nowIso(), nowIso(), orderId, actor.userId)
      .run();
    return r.meta.changes === 1;
  }
  throw new ForbiddenError();
}

/**
 * Repartidor toma un pedido libre. Concurrencia optimista: solo gana si sigue
 * sin dueño (dos repartidores a la vez → uno solo queda asignado).
 */
export async function claimOrder(db: SqlDatabase, actor: Actor, orderId: string, courierName: string): Promise<boolean> {
  if (actor.kind !== "repartidor") throw new ForbiddenError();
  const r = await db
    .prepare("UPDATE orders SET courier_user_id = ?, courier_name = ?, updated_at = ? WHERE id = ? AND courier_user_id IS NULL AND status IN ('En Preparación','En Camino')")
    .bind(actor.userId, courierName, nowIso(), orderId)
    .run();
  return r.meta.changes === 1;
}

/** Admin asigna o libera un pedido (antes se escribía courier_name a mano). */
export async function assignOrder(db: SqlDatabase, actor: Actor, orderId: string, courierUserId: string | null, courierName: string | null): Promise<boolean> {
  if (!isStaff(actor)) throw new ForbiddenError();
  const r = await db
    .prepare("UPDATE orders SET courier_user_id = ?, courier_name = ?, updated_at = ? WHERE id = ?")
    .bind(courierUserId, courierName, nowIso(), orderId)
    .run();
  return r.meta.changes === 1;
}
