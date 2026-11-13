import { ForbiddenError, isStaff, type Actor } from "./actor.ts";
import { ownClientId } from "./clients.ts";
import type { SqlDatabase, SqlStatement } from "./sql.ts";

export interface LedgerRow {
  id: string;
  client_id: string;
  order_id: string | null;
  delta: number;
  description: string;
  created_at: string;
}

/** G6: el cliente lee solo su ledger. */
export async function listLedger(db: SqlDatabase, actor: Actor, clientId?: string): Promise<LedgerRow[]> {
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
  if (!target) return [];
  const { results } = await db
    .prepare("SELECT id, client_id, order_id, delta, description, created_at FROM points_ledger WHERE client_id = ? ORDER BY created_at DESC")
    .bind(target)
    .all<LedgerRow>();
  return results;
}

export class InsufficientPointsError extends Error {
  constructor() {
    super("Puntos insuficientes");
    this.name = "InsufficientPointsError";
  }
}

/**
 * Asiento en el ledger (acreditación o canje). Solo servidor (G6).
 * El trigger suma el delta a clients.total_points y el CHECK >= 0 hace fallar
 * el INSERT si el saldo no alcanza: un canje doble concurrente no puede
 * gastar el mismo saldo dos veces (D1 serializa las escrituras).
 */
export interface LedgerEntry {
  id: string;
  clientId: string;
  delta: number;
  description: string;
  orderId?: string | null;
  /** Clave única del hecho que genera el asiento (p. ej. `earn:<order_id>`): repetir no duplica. */
  idempotencyKey?: string | null;
}

/**
 * Sentencia de asiento para usar dentro de un batch (p. ej. efectos de un
 * pago). La idempotencyKey es OBLIGATORIA acá: con NULL no hay protección.
 */
export function addPointsStatement(db: SqlDatabase, actor: Actor, entry: LedgerEntry & { idempotencyKey: string }): SqlStatement {
  if (!entry.idempotencyKey?.trim()) throw new Error("idempotencyKey obligatoria en efectos de pago");
  return ledgerStatement(db, actor, entry);
}

function ledgerStatement(db: SqlDatabase, actor: Actor, entry: LedgerEntry): SqlStatement {
  if (!isStaff(actor)) throw new ForbiddenError();
  if (!Number.isSafeInteger(entry.delta) || entry.delta === 0) throw new Error("delta inválido");
  return db
    .prepare(
      "INSERT INTO points_ledger (id, client_id, order_id, delta, description, idempotency_key) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING",
    )
    .bind(entry.id, entry.clientId, entry.orderId ?? null, entry.delta, entry.description, entry.idempotencyKey ?? null);
}

/** Devuelve false si el asiento ya existía (misma idempotencyKey). */
export async function addPoints(db: SqlDatabase, actor: Actor, entry: LedgerEntry): Promise<boolean> {
  const stmt = ledgerStatement(db, actor, entry);
  try {
    return (await stmt.run()).meta.changes === 1;
  } catch (err) {
    if (err instanceof Error && /CHECK constraint failed/i.test(err.message)) throw new InsufficientPointsError();
    throw err;
  }
}
