import { createAdminClient } from "@/utils/supabase/admin";
import type { Database, OrderChannel, PaymentMethod } from "@/types/database";
import { buildItemsDesc, formatMoney, minutesSince, REWARDS, type Reward } from "@/lib/orders";
import { getClientById, numberConfig, readConfig, refundRedeemedPoints, applyPointsDelta } from "@/lib/orders-server";
import { applyReward, REDEEM_PREFIX, rewardNote } from "@/lib/rewards";
import { getGateway } from "@/lib/payments/gateway";
import { refundPaymentForOrder } from "@/lib/payments/refunds";
import { loadDeliverySettings } from "@/lib/zones-server";
import { quoteDelivery } from "@/lib/zones";

type Db = ReturnType<typeof createAdminClient>;
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

/** Resultado de una operación de negocio: el mensaje es apto para mostrarle al cliente. */
export type Outcome<T> = { ok: true; value: T } | { ok: false; status: number; message: string };

const fail = (status: number, message: string): { ok: false; status: number; message: string } => ({
  ok: false,
  status,
  message,
});

export interface OrderItemInput {
  productId: string;
  qty: number;
}

export interface DeliveryPoint {
  address: string;
  lat: number;
  lng: number;
}

export interface PricedOrder {
  lines: Array<{ productId: string; name: string; qty: number; price: number; categoryId: string | null }>;
  subtotal: number;
  fee: number;
  minOrder: number;
  zone: string | null;
}

/**
 * Precios, cobertura y envío de un pedido. Todo se recalcula acá contra `products`,
 * las zonas y la configuración: ni el cliente web ni el agente de IA fijan montos.
 */
export async function priceOrder(
  db: Db,
  items: readonly OrderItemInput[],
  point: DeliveryPoint,
): Promise<Outcome<PricedOrder>> {
  const { config, zones, quoteOptions } = await loadDeliverySettings(db);

  if (config.modo_pausa === true || config.tienda_activa === false) {
    return fail(409, "El local no está tomando pedidos en este momento.");
  }

  const quote = quoteDelivery(point, zones, quoteOptions);
  if (!quote.covered) return fail(400, quote.reason);

  const qtyByProduct = new Map<string, number>();
  for (const item of items) {
    qtyByProduct.set(item.productId, (qtyByProduct.get(item.productId) ?? 0) + item.qty);
  }

  const { data: products, error } = await db
    .from("products")
    .select("id, name, price, is_active, category_id")
    .in("id", [...qtyByProduct.keys()]);
  if (error) return fail(500, error.message);

  const lines: PricedOrder["lines"] = [];
  let subtotal = 0;
  for (const [productId, qty] of qtyByProduct) {
    const product = (products ?? []).find((p) => p.id === productId);
    if (!product || !product.is_active) return fail(400, "Un producto del carrito ya no está disponible.");
    const price = Number(product.price);
    subtotal += price * qty;
    lines.push({ productId, name: product.name, qty, price, categoryId: product.category_id ?? null });
  }

  if (subtotal < quote.minOrder) {
    return fail(400, `El pedido mínimo para tu zona es ${formatMoney(quote.minOrder)}.`);
  }
  return { ok: true, value: { lines, subtotal, fee: quote.fee, minOrder: quote.minOrder, zone: quote.zone } };
}

export interface NewDeliveryOrder {
  clientId: string;
  items: readonly OrderItemInput[];
  address: DeliveryPoint;
  paymentMethod: PaymentMethod;
  notes?: string | null;
  channel: OrderChannel;
  /** Quién lo crea, para la bitácora (cliente | agente). */
  actor: string;
  /** Total que el cliente vio y aceptó (ya con el canje): si el recálculo da otro monto, no se crea el pedido. */
  expectedTotal?: number;
  /** Recompensa de puntos a canjear en este pedido; los puntos se descuentan al crearlo. */
  rewardId?: string;
}

interface AppliedReward {
  reward: Reward;
  discount: number;
}

/**
 * Puntos comprometidos en canjes con pago online todavía pendiente: se cobran al aprobarse el pago,
 * así que mientras tanto no se pueden usar en otro pedido (si no, el mismo saldo pagaría dos canjes).
 */
async function reservedPoints(db: Db, clientId: string): Promise<number> {
  const { data } = await db
    .from("payment_intents")
    .select("snapshot")
    .eq("client_id", clientId)
    .eq("status", "pending")
    .gt("expires_at", new Date().toISOString());
  return (data ?? []).reduce((sum, row) => {
    const reward = (row.snapshot as { reward?: { puntos?: unknown } | null } | null)?.reward;
    return sum + (typeof reward?.puntos === "number" ? reward.puntos : 0);
  }, 0);
}

/** Valida el canje contra el saldo disponible (sin lo reservado) y el contenido del pedido, y calcula cuánto descuenta. */
async function resolveReward(
  db: Db,
  clientId: string,
  rewardId: string,
  priced: PricedOrder,
): Promise<Outcome<AppliedReward>> {
  const reward = REWARDS.find((r) => r.id === rewardId);
  if (!reward) return fail(400, "Recompensa inválida.");

  const client = await getClientById(db, clientId);
  if (!client || client.total_points - (await reservedPoints(db, clientId)) < reward.puntosRequeridos) {
    return fail(409, "No te alcanzan los puntos para este canje.");
  }

  const { data: categories } = await db.from("categories").select("id, name");
  const nameById = new Map((categories ?? []).map((c) => [String(c.id), String(c.name)]));
  const outcome = applyReward(
    reward,
    priced.lines.map((l) => ({ qty: l.qty, price: l.price, categoria: l.categoryId ? (nameById.get(l.categoryId) ?? null) : null })),
    priced.subtotal,
  );
  if (!outcome.ok) return fail(400, outcome.message);
  return { ok: true, value: { reward, discount: outcome.discount } };
}

/**
 * Pedido ya cotizado y validado, listo para insertarse. Es lo que guarda una intención de pago:
 * cuando el pago se aprueba se crea el pedido desde esta foto, sin volver a cotizar.
 */
export interface OrderSnapshot {
  clientId: string;
  itemsDesc: string;
  total: number;
  fee: number;
  address: DeliveryPoint;
  paymentMethod: PaymentMethod;
  notes: string | null;
  channel: OrderChannel;
  actor: string;
  /** Canje de puntos aplicado: se cobra al crear el pedido. */
  reward: { id: string; nombre: string; puntos: number } | null;
}

/** Cotiza el pedido: precios, cobertura, envío y canje. No escribe nada. */
export async function prepareDeliveryOrder(db: Db, input: NewDeliveryOrder): Promise<Outcome<OrderSnapshot>> {
  const priced = await priceOrder(db, input.items, input.address);
  if (!priced.ok) return priced;
  const { lines, subtotal, fee } = priced.value;

  let applied: AppliedReward | null = null;
  if (input.rewardId) {
    const resolved = await resolveReward(db, input.clientId, input.rewardId, priced.value);
    if (!resolved.ok) return resolved;
    applied = resolved.value;
  }
  const total = subtotal - (applied?.discount ?? 0) + fee;
  if (input.expectedTotal !== undefined && total !== input.expectedTotal) {
    return fail(409, "El precio cambió desde la cotización. Hay que volver a cotizar.");
  }
  const notes = [input.notes?.trim(), applied && rewardNote(applied.reward, applied.discount)].filter(Boolean).join(" · ");

  return {
    ok: true,
    value: {
      clientId: input.clientId,
      itemsDesc: buildItemsDesc(lines),
      total,
      fee,
      address: input.address,
      paymentMethod: input.paymentMethod,
      notes: notes || null,
      channel: input.channel,
      actor: input.actor,
      reward: applied ? { id: applied.reward.id, nombre: applied.reward.nombre, puntos: applied.reward.puntosRequeridos } : null,
    },
  };
}

/** Inserta el pedido de una cotización, cobra los puntos del canje y deja la bitácora. */
export async function placeOrder(db: Db, snapshot: OrderSnapshot, event = "Recibidos"): Promise<Outcome<OrderRow>> {
  const { data: order, error } = await db
    .from("orders")
    .insert({
      client_id: snapshot.clientId,
      status: "Recibidos",
      items_desc: snapshot.itemsDesc,
      total: snapshot.total,
      delivery_fee: snapshot.fee,
      delivery_address: snapshot.address.address,
      delivery_lat: snapshot.address.lat,
      delivery_lng: snapshot.address.lng,
      payment_method: snapshot.paymentMethod,
      notes: snapshot.notes,
      channel: snapshot.channel,
    })
    .select()
    .single();
  if (error) return fail(500, error.message);

  // Los puntos se cobran recién con el pedido creado y ligados a él, para poder devolverlos si se cancela.
  if (snapshot.reward) {
    await applyPointsDelta(db, snapshot.clientId, -snapshot.reward.puntos, `${REDEEM_PREFIX}${snapshot.reward.nombre}`, order.id);
  }

  // La bitácora no debe tumbar el pedido ya creado.
  await db.from("order_events").insert({ order_id: order.id, event, actor: snapshot.actor });
  return { ok: true, value: order };
}

export async function createDeliveryOrder(db: Db, input: NewDeliveryOrder): Promise<Outcome<OrderRow>> {
  const prepared = await prepareDeliveryOrder(db, input);
  if (!prepared.ok) return prepared;
  return placeOrder(db, prepared.value);
}

/** El cliente solo cancela mientras el pedido siga "Recibidos" y dentro de la ventana configurada. */
export async function cancelOrderForClient(db: Db, orderId: string, clientId: string, actor: string): Promise<Outcome<OrderRow>> {
  const { data: order } = await db
    .from("orders")
    .select("id, status, created_at")
    .eq("id", orderId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (!order) return fail(404, "Pedido no encontrado.");

  const cancelWindow = numberConfig(await readConfig(db), "cancelacion_min", 15);
  if (order.status !== "Recibidos") {
    return fail(
      409,
      order.status === "Finalizados"
        ? "El pedido ya fue entregado y no se puede cancelar."
        : order.status === "Cancelado"
          ? "El pedido ya está cancelado."
          : "El pedido ya está en preparación y no se puede cancelar.",
    );
  }
  if (minutesSince(order.created_at) > cancelWindow) {
    return fail(409, `Pasaron más de ${cancelWindow} minutos: ya no se puede cancelar.`);
  }

  // Condicional: si la cocina lo aceptó entre la lectura y este update, no se pisa el estado.
  const { data, error } = await db
    .from("orders")
    .update({ status: "Cancelado" })
    .eq("id", order.id)
    .eq("status", "Recibidos")
    .select()
    .maybeSingle();
  if (error) return fail(500, error.message);
  if (!data) return fail(409, "El pedido ya cambió de estado y no se puede cancelar.");

  await db.from("order_events").insert({ order_id: order.id, event: "Cancelado", actor });
  await settleCancellation(db, order.id);
  return { ok: true, value: data };
}

/** Lo que corresponde devolver cuando un pedido se cancela: los puntos canjeados y, si se pagó online, el pago. */
export async function settleCancellation(db: Db, orderId: string): Promise<void> {
  await refundRedeemedPoints(db, orderId);
  const refund = await refundPaymentForOrder(db, getGateway(), orderId);
  if (refund.error) {
    await db.from("order_events").insert({ order_id: orderId, event: "reembolso_pendiente", actor: "sistema", detail: refund.error.slice(0, 200) });
  }
}

/** Cancelación por el sistema (pago devuelto o contracargo): no depende de la ventana del cliente. */
export async function cancelOrderBySystem(db: Db, orderId: string, actor: string): Promise<boolean> {
  const { data } = await db
    .from("orders")
    .update({ status: "Cancelado" })
    .eq("id", orderId)
    .in("status", ["Recibidos", "En Preparación", "En Camino"])
    .select("id")
    .maybeSingle();
  if (!data) return false;
  await db.from("order_events").insert({ order_id: orderId, event: "Cancelado", actor });
  await refundRedeemedPoints(db, orderId);
  return true;
}
