import { ForbiddenError, isStaff, type Actor } from "./actor.ts";
import { ownClientId } from "./clients.ts";
import type { SqlDatabase } from "./sql.ts";

export interface ReviewRow {
  id: string;
  order_id: string;
  client_id: string;
  rating: number;
  feedback: string | null;
  created_at: string;
}

const COLS = "id, order_id, client_id, rating, feedback, created_at";

/** G7: el cliente lee solo sus reseñas. */
export async function listReviews(db: SqlDatabase, actor: Actor, limit = 100): Promise<ReviewRow[]> {
  const lim = Math.min(Math.max(limit, 1), 500);
  if (isStaff(actor)) {
    return (await db.prepare(`SELECT ${COLS} FROM reviews ORDER BY created_at DESC LIMIT ?`).bind(lim).all<ReviewRow>()).results;
  }
  if (actor.kind !== "cliente") throw new ForbiddenError();
  const clientId = await ownClientId(db, actor.userId);
  if (!clientId) return [];
  return (
    await db.prepare(`SELECT ${COLS} FROM reviews WHERE client_id = ? ORDER BY created_at DESC LIMIT ?`).bind(clientId, lim).all<ReviewRow>()
  ).results;
}

export type ReviewEligibility = "ok" | "forbidden" | "not_delivered" | "already_reviewed";

/** Por qué se puede (o no) reseñar un pedido: para responder 403/409 sin consultar otra base. */
export async function reviewEligibility(db: SqlDatabase, actor: Actor, orderId: string): Promise<ReviewEligibility> {
  if (actor.kind !== "cliente") throw new ForbiddenError();
  const row = await db
    .prepare(
      `SELECT o.status AS status, (SELECT COUNT(*) FROM reviews r WHERE r.order_id = o.id) AS n
         FROM orders o JOIN clients c ON c.id = o.client_id WHERE o.id = ? AND c.user_id = ?`,
    )
    .bind(orderId, actor.userId)
    .first<{ status: string; n: number }>();
  if (!row) return "forbidden";
  if (row.status !== "Finalizados") return "not_delivered";
  return Number(row.n) > 0 ? "already_reviewed" : "ok";
}

/**
 * Reseña del cliente sobre SU pedido entregado. El client_id sale de la
 * sesión; el INSERT…SELECT solo inserta si el pedido es suyo y está Finalizado.
 * Una reseña por pedido (UNIQUE order_id).
 */
export async function createOwnReview(
  db: SqlDatabase,
  actor: Actor,
  input: { id: string; orderId: string; rating: number; feedback?: string | null },
): Promise<boolean> {
  if (actor.kind !== "cliente") throw new ForbiddenError();
  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error("rating inválido");
  const r = await db
    .prepare(
      `INSERT INTO reviews (id, order_id, client_id, rating, feedback)
       SELECT ?, o.id, o.client_id, ?, ?
         FROM orders o JOIN clients c ON c.id = o.client_id
        WHERE o.id = ? AND c.user_id = ? AND o.status = 'Finalizados'
       ON CONFLICT (order_id) DO NOTHING`,
    )
    .bind(input.id, input.rating, input.feedback ?? null, input.orderId, actor.userId)
    .run();
  return r.meta.changes === 1;
}
