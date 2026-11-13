import { ForbiddenError, isStaff, requireStaff, type Actor } from "./actor.ts";
import { ownClientId } from "./clients.ts";
import { assertCents } from "./money.ts";
import { nowIso, type SqlDatabase, type SqlStatement } from "./sql.ts";

export interface PaymentIntentRow {
  id: string;
  client_id: string;
  status: string;
  total_cents: number;
  order_id: string | null;
  mp_payment_id: string | null;
  checkout_url: string | null;
  expires_at: string;
  version: number;
}

const COLS = "id, client_id, status, total_cents, order_id, mp_payment_id, checkout_url, expires_at, version";

/** G11: el cliente consulta solo sus intenciones de pago (vía la capa, no directo). */
export async function getPaymentIntent(db: SqlDatabase, actor: Actor, id: string): Promise<PaymentIntentRow | null> {
  if (isStaff(actor)) return db.prepare(`SELECT ${COLS} FROM payment_intents WHERE id = ?`).bind(id).first<PaymentIntentRow>();
  if (actor.kind !== "cliente") throw new ForbiddenError();
  const clientId = await ownClientId(db, actor.userId);
  if (!clientId) return null;
  return db.prepare(`SELECT ${COLS} FROM payment_intents WHERE id = ? AND client_id = ?`).bind(id, clientId).first<PaymentIntentRow>();
}

export async function createPaymentIntent(
  db: SqlDatabase,
  actor: Actor,
  p: { id: string; clientId: string; channel: "web" | "whatsapp" | "mostrador"; totalCents: number; snapshot: unknown; expiresAt: string },
): Promise<void> {
  requireStaff(actor);
  assertCents(p.totalCents, "total_cents");
  await db
    .prepare("INSERT INTO payment_intents (id, client_id, channel, total_cents, snapshot, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(p.id, p.clientId, p.channel, p.totalCents, JSON.stringify(p.snapshot), p.expiresAt)
    .run();
}

/**
 * G15: aprobación idempotente. Solo pasa pending→approved una vez; el webhook
 * repetido (o dos webhooks a la vez) obtiene `false` y no repite efectos.
 * `effects` (crear pedido, items, eventos, puntos) se ejecutan en el MISMO
 * batch atómico y condicionados a que la transición haya ocurrido: cada
 * efecto debe incluir `WHERE EXISTS (SELECT 1 FROM payment_intents WHERE id = ? AND status = 'approved' AND mp_payment_id = ?)`
 * o depender de la fila aprobada. Si un efecto falla, se revierte también
 * la transición.
 */
export async function approvePaymentIntent(
  db: SqlDatabase,
  actor: Actor,
  p: { id: string; mpPaymentId: string; expectedVersion: number },
  effects: (db: SqlDatabase) => SqlStatement[] = () => [],
): Promise<boolean> {
  requireStaff(actor);
  const transition = db
    .prepare(
      "UPDATE payment_intents SET status = 'approved', mp_payment_id = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'pending' AND version = ?",
    )
    .bind(p.mpPaymentId, nowIso(), p.id, p.expectedVersion);
  const [first] = await db.batch([transition, ...effects(db)]);
  return first.meta.changes === 1;
}

/** Cancelación/expiración: solo desde pending. */
export async function closePaymentIntent(db: SqlDatabase, actor: Actor, id: string, status: "cancelled" | "expired"): Promise<boolean> {
  requireStaff(actor);
  const r = await db
    .prepare("UPDATE payment_intents SET status = ?, version = version + 1, updated_at = ? WHERE id = ? AND status = 'pending'")
    .bind(status, nowIso(), id)
    .run();
  return r.meta.changes === 1;
}
