/** Armado del cuerpo de `POST /orders` de Fudo a partir de un pedido de Deli-Gastro. Sin I/O: se prueba solo. */

export interface OrderForFudo {
  id: string;
  total: number;
  delivery_fee: number;
  delivery_address: string | null;
  payment_method: string | null;
  notes: string | null;
  client: { name: string; phone: string | null } | null;
  items: Array<{ product_id: string | null; name: string; qty: number; unit_price: number }>;
}

export interface FudoMaps {
  /** products.id (uuid) → id entero del producto en Fudo. */
  products: ReadonlyMap<string, number>;
  /** Efectivo | Tarjeta | Mercado Pago → id del medio de pago en Fudo. */
  payments: ReadonlyMap<string, number>;
}

export interface FudoOrderBody {
  order: {
    externalId: string;
    type: "delivery";
    typeOptions: { address: string };
    items: Array<{ product: { id: number }; quantity: number; price: number }>;
    customer?: { name: string; phone?: string };
    shippingCost?: number;
    discounts?: Array<{ amount: number }>;
    payment?: { total: number; paymentMethod?: { id: number } };
    comment?: string;
  };
}

export type BuildResult = { ok: true; body: FudoOrderBody } | { ok: false; reason: string };

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const round2 = (n: number): number => Math.round(n * 100) / 100;

export function buildFudoOrder(order: OrderForFudo, maps: FudoMaps): BuildResult {
  if (order.items.length === 0) return { ok: false, reason: "El pedido no tiene líneas guardadas (order_items)." };

  const unmapped = order.items.filter((i) => !i.product_id || !maps.products.has(i.product_id)).map((i) => i.name);
  if (unmapped.length > 0) return { ok: false, reason: `Productos sin mapear a Fudo: ${unmapped.join(", ")}` };

  const items = order.items.map((i) => ({
    product: { id: maps.products.get(i.product_id!)! },
    quantity: i.qty,
    price: round2(i.unit_price),
  }));

  // El canje de puntos no viaja como línea: es la diferencia entre lo que suman las líneas + envío y el total cobrado.
  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const discount = round2(subtotal + order.delivery_fee - order.total);

  const paymentId = order.payment_method ? maps.payments.get(order.payment_method) : undefined;
  const body: FudoOrderBody = {
    order: {
      externalId: order.id,
      type: "delivery",
      typeOptions: { address: clip(order.delivery_address?.trim() || "Sin dirección", 254) },
      items,
      payment: { total: round2(order.total), ...(paymentId !== undefined ? { paymentMethod: { id: paymentId } } : {}) },
    },
  };
  if (order.client?.name.trim()) {
    body.order.customer = {
      name: clip(order.client.name.trim(), 90),
      ...(order.client.phone?.trim() ? { phone: clip(order.client.phone.trim(), 90) } : {}),
    };
  }
  if (order.delivery_fee > 0) body.order.shippingCost = round2(order.delivery_fee);
  if (discount > 0) body.order.discounts = [{ amount: discount }];

  const comment = [order.notes?.trim(), order.payment_method && paymentId === undefined ? `Pago: ${order.payment_method}` : null]
    .filter(Boolean)
    .join(" · ");
  if (comment) body.order.comment = clip(comment, 254);
  return { ok: true, body };
}

/** Webhook de Fudo: el formato del cuerpo no está documentado, así que se busca el evento y el pedido en los lugares probables. */
export interface ParsedWebhook {
  event: string | null;
  fudoOrderId: number | null;
  externalId: string | null;
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const pick = (...values: unknown[]): unknown => values.find((v) => v !== undefined && v !== null && v !== "");

export function parseFudoWebhook(json: unknown, eventHeader: string | null): ParsedWebhook {
  const root = asRecord(json) ?? {};
  const data = asRecord(root.data) ?? {};
  const order = asRecord(root.order) ?? asRecord(data.order) ?? {};

  const event = pick(root.event, root.type, root.eventType, root.topic, data.event, eventHeader);
  const id = pick(order.id, root.orderId, data.orderId, data.id, root.id);
  const externalId = pick(order.externalId, root.externalId, data.externalId);

  const numericId = typeof id === "number" ? id : typeof id === "string" && /^\d+$/.test(id) ? Number(id) : null;
  return {
    event: typeof event === "string" ? event.trim().toUpperCase().replace(/_/g, "-") : null,
    fudoOrderId: numericId,
    externalId: typeof externalId === "string" ? externalId : null,
  };
}
