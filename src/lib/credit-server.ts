import type { createAdminClient } from "@/utils/supabase/admin";

/**
 * Saldo a favor (migración 0024) sobre el cliente compatible con supabase-js: lo usan el cobro, la cancelación,
 * el portal y el bot. Los montos van en PESOS (el motor D1 los pasa a centavos). La resolución de reclamos usa
 * la capa de datos directa (`src/lib/data/credit.ts`).
 *
 * Atomicidad: el asiento en `credit_ledger` es una sola sentencia; el trigger de D1 suma el delta al saldo y el
 * CHECK `credit_cents >= 0` hace fallar el INSERT si no alcanza, así que dos compras concurrentes no pueden gastar
 * el mismo saldo. Cada asiento lleva `idempotency_key` única (ON CONFLICT DO NOTHING): repetirlo no mueve el saldo.
 * Con DATA_BACKEND=supabase (sin la migración) no existe la columna ni la tabla: el saldo se lee como 0.
 */
type Db = ReturnType<typeof createAdminClient>;

export type CreditMotivo = "reclamo" | "compra" | "devolucion" | "ajuste";

/** Clave del débito de un pedido y de su devolución (mismas que usa la cancelación). */
export const orderCreditKey = (orderId: string) => `orden:${orderId}:credito`;
export const orderCreditRefundKey = (orderId: string) => `orden:${orderId}:credito:devolucion`;

/** Saldo del cliente en pesos (0 si no hay cliente, columna o saldo). */
export async function clientCredit(db: Db, clientId: string): Promise<number> {
  const { data } = await db.from("clients").select("credit").eq("id", clientId).maybeSingle();
  const credit = Number((data as { credit?: unknown } | null)?.credit ?? 0);
  return Number.isFinite(credit) && credit > 0 ? credit : 0;
}

/**
 * Saldo comprometido en pagos online todavía pendientes: se descuenta al aprobarse el pago, así que mientras
 * tanto no se puede usar en otro pedido (si no, el mismo saldo pagaría dos pedidos). Igual que los puntos.
 */
export async function reservedCredit(db: Db, clientId: string): Promise<number> {
  const { data } = await db
    .from("payment_intents")
    .select("snapshot")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  return (data ?? []).reduce((sum, row) => {
    const applied = (row.snapshot as { creditApplied?: unknown } | null)?.creditApplied;
    return sum + (typeof applied === "number" && applied > 0 ? applied : 0);
  }, 0);
}

/** Saldo que el cliente puede usar ahora: el saldo menos lo reservado por intenciones de pago pendientes. */
export async function availableCredit(db: Db, clientId: string): Promise<number> {
  const credit = await clientCredit(db, clientId);
  if (credit <= 0) return 0;
  return Math.max(0, credit - (await reservedCredit(db, clientId)));
}

export type CreditWrite = "ok" | "duplicate" | "insufficient" | "error";

interface CreditInput {
  clientId: string;
  /** Pesos: positivo acredita, negativo debita. */
  delta: number;
  motivo: CreditMotivo;
  idempotencyKey: string;
  orderId?: string | null;
  description?: string;
}

/** Asienta un movimiento. `insufficient` si deja el saldo negativo; `duplicate` si la clave ya existía. */
export async function writeCredit(db: Db, input: CreditInput): Promise<CreditWrite> {
  if (!Number.isFinite(input.delta) || input.delta === 0) return "error";
  const { data, error } = await db
    .from("credit_ledger")
    .upsert(
      {
        client_id: input.clientId,
        order_id: input.orderId ?? null,
        delta: input.delta,
        motivo: input.motivo,
        description: input.description ?? null,
        idempotency_key: input.idempotencyKey,
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true },
    )
    .select();
  if (error) return /CHECK constraint/i.test(error.message) ? "insufficient" : "error";
  return (data ?? []).length > 0 ? "ok" : "duplicate";
}

/** Liga el asiento de compra con el pedido recién creado (el débito se hace antes de que el pedido exista). */
export async function linkCreditToOrder(db: Db, orderId: string): Promise<void> {
  await db
    .from("credit_ledger")
    .update({ order_id: orderId } as never)
    .eq("idempotency_key", orderCreditKey(orderId))
    .is("order_id", null);
}

/**
 * Devuelve el saldo usado en un pedido que se canceló. Idempotente por la clave de la devolución: la segunda
 * cancelación (cliente y admin a la vez) no acredita dos veces. Devuelve los pesos acreditados ahora.
 */
export async function refundCreditForOrder(db: Db, orderId: string, opts: { linkOrder?: boolean } = {}): Promise<number> {
  const { data } = await db
    .from("credit_ledger")
    .select("client_id, delta")
    .eq("idempotency_key", orderCreditKey(orderId))
    .maybeSingle();
  const spent = data ? -Number(data.delta) : 0;
  if (!data || spent <= 0) return 0;
  const written = await writeCredit(db, {
    clientId: data.client_id,
    delta: spent,
    motivo: "devolucion",
    idempotencyKey: orderCreditRefundKey(orderId),
    // Si el pedido nunca llegó a crearse no se lo puede referenciar (clave foránea).
    orderId: opts.linkOrder === false ? null : orderId,
    description: "Pedido cancelado",
  });
  return written === "ok" ? spent : 0;
}
