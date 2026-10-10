import { createAdminClient } from "@/utils/supabase/admin";
import type { Database, OrderChannel, PaymentMethod } from "@/types/database";
import { buildItemsDesc, formatMoney, minutesSince } from "@/lib/orders";
import { numberConfig, readConfig } from "@/lib/orders-server";
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
  lines: Array<{ productId: string; name: string; qty: number; price: number }>;
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
    .select("id, name, price, is_active")
    .in("id", [...qtyByProduct.keys()]);
  if (error) return fail(500, error.message);

  const lines: PricedOrder["lines"] = [];
  let subtotal = 0;
  for (const [productId, qty] of qtyByProduct) {
    const product = (products ?? []).find((p) => p.id === productId);
    if (!product || !product.is_active) return fail(400, "Un producto del carrito ya no está disponible.");
    const price = Number(product.price);
    subtotal += price * qty;
    lines.push({ productId, name: product.name, qty, price });
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
  /** Total que el cliente vio y aceptó: si el recálculo da otro monto, no se crea el pedido. */
  expectedTotal?: number;
}

export async function createDeliveryOrder(db: Db, input: NewDeliveryOrder): Promise<Outcome<OrderRow>> {
  const priced = await priceOrder(db, input.items, input.address);
  if (!priced.ok) return priced;
  const { lines, subtotal, fee } = priced.value;
  if (input.expectedTotal !== undefined && subtotal + fee !== input.expectedTotal) {
    return fail(409, "El precio cambió desde la cotización. Hay que volver a cotizar.");
  }

  const { data: order, error } = await db
    .from("orders")
    .insert({
      client_id: input.clientId,
      status: "Recibidos",
      items_desc: buildItemsDesc(lines),
      total: subtotal + fee,
      delivery_fee: fee,
      delivery_address: input.address.address,
      delivery_lat: input.address.lat,
      delivery_lng: input.address.lng,
      payment_method: input.paymentMethod,
      notes: input.notes || null,
      channel: input.channel,
    })
    .select()
    .single();
  if (error) return fail(500, error.message);

  // La bitácora no debe tumbar el pedido ya creado.
  await db.from("order_events").insert({ order_id: order.id, event: "Recibidos", actor: input.actor });
  return { ok: true, value: order };
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
  return { ok: true, value: data };
}
