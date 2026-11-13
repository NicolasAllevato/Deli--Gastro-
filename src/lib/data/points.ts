import { ForbiddenError, isStaff, type Actor } from "./actor.ts";
import { ownClientId } from "./clients.ts";
import type { SqlDatabase } from "./sql.ts";

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
export async function addPoints(
  db: SqlDatabase,
  actor: Actor,
  entry: { id: string; clientId: string; delta: number; description: string; orderId?: string | null },
): Promise<void> {
  if (!isStaff(actor)) throw new ForbiddenError();
  if (!Number.isSafeInteger(entry.delta) || entry.delta === 0) throw new Error("delta inválido");
  try {
    await db
      .prepare("INSERT INTO points_ledger (id, client_id, order_id, delta, description) VALUES (?, ?, ?, ?, ?)")
      .bind(entry.id, entry.clientId, entry.orderId ?? null, entry.delta, entry.description)
      .run();
  } catch (err) {
    if (err instanceof Error && /CHECK constraint failed/i.test(err.message)) throw new InsufficientPointsError();
    throw err;
  }
}
