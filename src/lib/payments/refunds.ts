import { createAdminClient } from "@/utils/supabase/admin";
import type { PaymentGateway } from "./gateway.ts";
import { mirrorRowById } from "@/lib/d1-mirror";

type Db = ReturnType<typeof createAdminClient>;

export interface RefundResult {
  refunded: boolean;
  /** Mensaje apto para la bitácora si el reembolso falló y hay que resolverlo a mano. */
  error?: string;
}

/**
 * Si el pedido se pagó online y se cancela, devuelve el pago completo. Sin pago aprobado no hace nada.
 * Es idempotente: la clave del reembolso depende de la intención, y una vez devuelto queda en `refunded`.
 * Un fallo no frena la cancelación: se anota en `refund_error` para que el local lo resuelva.
 */
export async function refundPaymentForOrder(db: Db, gateway: PaymentGateway | null, orderId: string): Promise<RefundResult> {
  const { data } = await db
    .from("payment_intents")
    .select("id, mp_payment_id")
    .eq("order_id", orderId)
    .eq("status", "approved")
    .limit(1);
  const intent = data?.[0];
  if (!intent?.mp_payment_id) return { refunded: false };

  try {
    if (!gateway) throw new Error("El cobro digital no está configurado: reembolsar desde Mercado Pago.");
    await gateway.refund(intent.mp_payment_id, `refund-${intent.id}`);
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : "No se pudo reembolsar.";
    await db.from("payment_intents").update({ refund_error: error }).eq("id", intent.id);
    await mirrorRowById("refunds.error", db, "payment_intents", intent.id);
    return { refunded: false, error };
  }

  await db.from("payment_intents").update({ status: "refunded", refund_error: null }).eq("id", intent.id);
  await mirrorRowById("refunds.done", db, "payment_intents", intent.id);
  return { refunded: true };
}
