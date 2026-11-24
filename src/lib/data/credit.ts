/**
 * Saldo a favor del cliente (migración 0024): crédito en pesos que se otorga al resolver un reclamo y se
 * descuenta en la próxima compra. Es APARTE de los puntos de fidelidad. Los montos viajan en centavos.
 *
 * Mismo patrón que `points.ts`: un asiento en `credit_ledger` con `idempotency_key` única; el trigger suma
 * `delta_cents` a `clients.credit_cents` y el CHECK `>= 0` hace fallar el INSERT si el saldo no alcanza
 * (dentro de un batch, falla todo el batch). Repetir la misma clave no duplica el asiento.
 */
import { ForbiddenError, isStaff, requireStaff, type Actor } from "./actor.ts";
import { ownClientId } from "./clients.ts";
import { assertCents } from "./money.ts";
import type { SqlDatabase, SqlStatement } from "./sql.ts";

export const CREDIT_MOTIVOS = ["reclamo", "compra", "devolucion", "ajuste", "vencido"] as const;
export type CreditMotivo = (typeof CREDIT_MOTIVOS)[number];

export class InsufficientCreditError extends Error {
  constructor() {
    super("Saldo a favor insuficiente");
    this.name = "InsufficientCreditError";
  }
}

export interface CreditEntry {
  id: string;
  clientId: string;
  /** Centavos: positivo acredita, negativo debita. Nunca 0. */
  deltaCents: number;
  motivo: CreditMotivo;
  /** Clave única del hecho (`reclamo:<id>:saldo`, `orden:<id>:credito`…): repetir no duplica. */
  idempotencyKey: string;
  orderId?: string | null;
  reclamoId?: string | null;
  description?: string | null;
}

/** Sentencia de asiento para un batch. La idempotencyKey es obligatoria: sin ella no hay protección. */
export function addCreditStatement(db: SqlDatabase, actor: Actor, entry: CreditEntry): SqlStatement {
  if (!isStaff(actor)) throw new ForbiddenError();
  if (!entry.idempotencyKey?.trim()) throw new Error("idempotencyKey obligatoria en asientos de saldo");
  if (!Number.isSafeInteger(entry.deltaCents) || entry.deltaCents === 0) throw new Error("delta inválido");
  if (!CREDIT_MOTIVOS.includes(entry.motivo)) throw new Error("motivo inválido");
  return db
    .prepare(
      `INSERT INTO credit_ledger (id, client_id, order_id, reclamo_id, delta_cents, motivo, description, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING`,
    )
    .bind(entry.id, entry.clientId, entry.orderId ?? null, entry.reclamoId ?? null, entry.deltaCents, entry.motivo, entry.description ?? null, entry.idempotencyKey);
}

/** Asienta el movimiento. Devuelve false si ya existía (misma idempotencyKey). Lanza InsufficientCreditError si deja el saldo negativo. */
export async function addCredit(db: SqlDatabase, actor: Actor, entry: CreditEntry): Promise<boolean> {
  const stmt = addCreditStatement(db, actor, entry);
  try {
    return (await stmt.run()).meta.changes === 1;
  } catch (err) {
    if (err instanceof Error && /CHECK constraint failed/i.test(err.message)) throw new InsufficientCreditError();
    throw err;
  }
}

/** Saldo del cliente en centavos. El cliente solo ve el suyo; el personal, el de cualquiera. */
export async function getCredit(db: SqlDatabase, actor: Actor, clientId?: string): Promise<number> {
  let target: string | null;
  if (isStaff(actor)) {
    if (!clientId) throw new Error("clientId requerido");
    target = clientId;
  } else if (actor.kind === "cliente") {
    target = await ownClientId(db, actor.userId);
    if (clientId && clientId !== target) throw new ForbiddenError();
  } else {
    throw new ForbiddenError();
  }
  if (!target) return 0;
  const row = await db.prepare("SELECT credit_cents FROM clients WHERE id = ?").bind(target).first<{ credit_cents: number }>();
  return assertCents(row?.credit_cents ?? 0, "credit_cents");
}

export interface CreditLedgerRow {
  id: string;
  order_id: string | null;
  reclamo_id: string | null;
  delta_cents: number;
  motivo: CreditMotivo;
  description: string | null;
  created_at: string;
}

/** Movimientos del cliente, del más nuevo al más viejo (solo personal: el panel). */
export async function listCreditLedger(db: SqlDatabase, actor: Actor, clientId: string, limit = 100): Promise<CreditLedgerRow[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare("SELECT id, order_id, reclamo_id, delta_cents, motivo, description, created_at FROM credit_ledger WHERE client_id = ? ORDER BY created_at DESC LIMIT ?")
    .bind(clientId, Math.min(Math.max(limit, 1), 500))
    .all<CreditLedgerRow>();
  return results;
}
