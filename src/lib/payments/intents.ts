import { createAdminClient } from "@/utils/supabase/admin";
import type { Database, Json, OrderChannel } from "@/types/database";
import { cancelOrderBySystem, placeOrder, prepareDeliveryOrder, type NewDeliveryOrder, type OrderSnapshot, type Outcome } from "@/lib/orders-create";
import { formatMoney } from "@/lib/orders";
import type { PaymentGateway } from "./gateway.ts";
import { classifyPaymentStatus, paymentMatchesIntent, PAYMENT_WINDOW_MINUTES, type MpPayment } from "./mercadopago.ts";

type Db = ReturnType<typeof createAdminClient>;
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];
type IntentRow = Database["public"]["Tables"]["payment_intents"]["Row"];

const fail = (status: number, message: string): { ok: false; status: number; message: string } => ({ ok: false, status, message });

export interface StartedPayment {
  intentId: string;
  url: string;
  total: number;
  expiresAt: string;
}

/**
 * Cotiza el pedido y abre el cobro: guarda una intención con el pedido ya cotizado y pide a Mercado Pago
 * el link de pago. El pedido NO se crea acá: lo crea `settlePayment` cuando el pago se aprueba.
 */
export async function startOnlinePayment(
  db: Db,
  gateway: PaymentGateway,
  input: NewDeliveryOrder,
  opts: { payerEmail?: string | null; now?: Date } = {},
): Promise<Outcome<StartedPayment>> {
  const now = opts.now ?? new Date();
  await expireDueIntents(db, now);

  const prepared = await prepareDeliveryOrder(db, { ...input, paymentMethod: "Mercado Pago" });
  if (!prepared.ok) return prepared;
  const snapshot = prepared.value;

  const expiresAt = new Date(now.getTime() + PAYMENT_WINDOW_MINUTES * 60_000);
  const { data: intent, error } = await db
    .from("payment_intents")
    .insert({
      client_id: snapshot.clientId,
      channel: snapshot.channel,
      total: snapshot.total,
      snapshot: snapshot as unknown as Json,
      expires_at: expiresAt.toISOString(),
    })
    .select()
    .single();
  if (error) return fail(500, error.message);

  try {
    const checkout = await gateway.createCheckout({
      intentId: intent.id,
      title: `Pedido ${formatMoney(snapshot.total)}`,
      total: snapshot.total,
      payerEmail: opts.payerEmail,
      expiresAt,
    });
    await db.from("payment_intents").update({ mp_preference_id: checkout.preferenceId, checkout_url: checkout.url }).eq("id", intent.id);
    return { ok: true, value: { intentId: intent.id, url: checkout.url, total: snapshot.total, expiresAt: expiresAt.toISOString() } };
  } catch {
    await db.from("payment_intents").update({ status: "cancelled" }).eq("id", intent.id).eq("status", "pending");
    return fail(502, "No pudimos abrir el pago con Mercado Pago. Probá de nuevo o elegí otra forma de pago.");
  }
}

export type SettleResult =
  | { kind: "order_created"; order: OrderRow }
  | { kind: "already_settled"; orderId: string | null }
  | { kind: "refunded_late" }
  | { kind: "order_cancelled" }
  | { kind: "no_change" }
  | { kind: "ignored"; reason: "unknown_intent" | "mismatch" };

/**
 * Aplica un pago ya verificado contra la API de Mercado Pago a su intención. Idempotente: el mismo aviso
 * llegando dos veces, o en paralelo, crea un solo pedido (gana el que logra pasar la intención a `approved`).
 */
export async function settlePayment(db: Db, gateway: PaymentGateway, intentId: string, payment: MpPayment): Promise<Outcome<SettleResult>> {
  const { data: intent } = await db.from("payment_intents").select("*").eq("id", intentId).maybeSingle();
  if (!intent) return { ok: true, value: { kind: "ignored", reason: "unknown_intent" } };
  if (!paymentMatchesIntent(payment, { id: intent.id, total: Number(intent.total) })) {
    return { ok: true, value: { kind: "ignored", reason: "mismatch" } };
  }

  const outcome = classifyPaymentStatus(payment.status);
  const paymentId = String(payment.id);

  if (outcome === "approved") return settleApproved(db, gateway, intent, paymentId);
  if (outcome === "reversed") return settleReversed(db, intent);
  return { ok: true, value: { kind: "no_change" } };
}

async function settleApproved(db: Db, gateway: PaymentGateway, intent: IntentRow, paymentId: string): Promise<Outcome<SettleResult>> {
  if (intent.status === "approved" || intent.status === "refunded") {
    return { ok: true, value: { kind: "already_settled", orderId: intent.order_id } };
  }

  if (intent.status !== "pending") {
    // Pagó una intención que ya se canceló o venció: no hay pedido que servir, se le devuelve el pago.
    try {
      await gateway.refund(paymentId, `refund-late-${intent.id}`);
      await db.from("payment_intents").update({ status: "refunded", mp_payment_id: paymentId }).eq("id", intent.id);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "No se pudo reembolsar.";
      await db.from("payment_intents").update({ mp_payment_id: paymentId, refund_error: message }).eq("id", intent.id);
      return fail(502, message);
    }
    return { ok: true, value: { kind: "refunded_late" } };
  }

  // Se reclama la intención antes de crear el pedido: solo un aviso logra pasar de `pending` a `approved`.
  const { data: claimed } = await db
    .from("payment_intents")
    .update({ status: "approved", mp_payment_id: paymentId })
    .eq("id", intent.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!claimed) return { ok: true, value: { kind: "already_settled", orderId: null } };

  const placed = await placeOrder(db, intent.snapshot as unknown as OrderSnapshot, "Recibidos");
  if (!placed.ok) {
    // Sin pedido no hay nada cobrado "en firme": se reabre la intención para que el reintento de Mercado Pago lo cree.
    await db.from("payment_intents").update({ status: "pending", mp_payment_id: null }).eq("id", intent.id);
    return placed;
  }

  await db.from("payment_intents").update({ order_id: placed.value.id }).eq("id", intent.id);
  await db.from("order_events").insert({ order_id: placed.value.id, event: "pago_aprobado", actor: "mercadopago" });
  return { ok: true, value: { kind: "order_created", order: placed.value } };
}

/** Pago devuelto o contracargo: si el pedido seguía en marcha se cancela (y vuelven los puntos del canje). */
async function settleReversed(db: Db, intent: IntentRow): Promise<Outcome<SettleResult>> {
  if (intent.status !== "approved" || !intent.order_id) return { ok: true, value: { kind: "no_change" } };
  await db.from("payment_intents").update({ status: "refunded" }).eq("id", intent.id);
  const cancelled = await cancelOrderBySystem(db, intent.order_id, "mercadopago");
  return { ok: true, value: cancelled ? { kind: "order_cancelled" } : { kind: "no_change" } };
}

/** Marca como vencidas las intenciones que nadie pagó a tiempo. Devuelve cuántas. */
export async function expireDueIntents(db: Db, now: Date = new Date()): Promise<number> {
  const { data } = await db
    .from("payment_intents")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", now.toISOString())
    .select("id");
  return data?.length ?? 0;
}

/**
 * Busca en Mercado Pago el pago de una intención pendiente y lo aplica. Es la red de seguridad cuando el
 * webhook no llegó (por ejemplo, desarrollo sin URL pública): la pantalla de pago la invoca al consultar.
 */
export async function reconcileIntent(db: Db, gateway: PaymentGateway, intentId: string): Promise<SettleResult | null> {
  const { data: intent } = await db.from("payment_intents").select("*").eq("id", intentId).maybeSingle();
  if (!intent || intent.status !== "pending") return null;

  const payments = await gateway.findPayments(intent.id).catch(() => []);
  const approved = payments.find((p) => classifyPaymentStatus(p.status) === "approved");
  if (!approved) return null;

  const settled = await settlePayment(db, gateway, intent.id, approved);
  return settled.ok ? settled.value : null;
}

/** El cliente (o el asistente en su nombre) abandona un pago que todavía no se aprobó. */
export async function cancelPendingIntent(db: Db, intentId: string, clientId: string): Promise<boolean> {
  const { data } = await db
    .from("payment_intents")
    .update({ status: "cancelled" })
    .eq("id", intentId)
    .eq("client_id", clientId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export interface IntentView {
  id: string;
  status: IntentRow["status"];
  total: number;
  orderId: string | null;
  channel: OrderChannel;
  expiresAt: string;
  /** Link para pagar (solo mientras la intención sigue pendiente). */
  checkoutUrl: string | null;
}

/** Intención de un cliente para mostrarle el estado de su pago (nunca la de otro). */
export async function getIntentForClient(db: Db, intentId: string, clientId: string): Promise<IntentView | null> {
  const { data } = await db.from("payment_intents").select("*").eq("id", intentId).eq("client_id", clientId).maybeSingle();
  if (!data) return null;
  const expired = data.status === "pending" && new Date(data.expires_at).getTime() < Date.now();
  return {
    id: data.id,
    status: expired ? "expired" : data.status,
    total: Number(data.total),
    orderId: data.order_id,
    channel: data.channel,
    expiresAt: data.expires_at,
    checkoutUrl: !expired && data.status === "pending" ? data.checkout_url : null,
  };
}

/** La intención sin pagar más reciente de un cliente (para que el asistente de WhatsApp sepa qué le falta pagar). */
export async function latestPendingIntent(db: Db, clientId: string, now: Date = new Date()): Promise<IntentRow | null> {
  const { data } = await db
    .from("payment_intents")
    .select("*")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .gt("expires_at", now.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}
