/** Armado del cuerpo de `POST /orders` de Fudo a partir de un pedido de Deli-Gastro. Sin I/O: se prueba solo. */

export interface OrderForFudo {
  id: string;
  total: number;
  delivery_fee: number;
  delivery_address: string | null;
  payment_method: string | null;
  notes: string | null;
  client: { name: string; phone: string | null } | null;
  items: Array<{ product_id: string | null; name: string; qty: number; unit_price: number; fudo_options?: OptionForFudo[] | null }>;
}

/**
 * Opción elegida en una línea (sabor de la docena, bebida de una promo), tal como queda en `order_items.fudo_options`.
 * `qty` es por unidad de la línea; `price` es el precio de una unidad de la opción (el `unit_price` de la línea ya lo incluye).
 */
export interface OptionForFudo {
  qty: number;
  name?: string;
  /** Producto de Fudo del sabor o la bebida (→ subitem.productId). */
  fudo_product_id?: number | null;
  /** Grupo de modificadores de Fudo (→ subitem.productGroupId). */
  group_fudo_id?: number | null;
  price?: number | null;
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
    items: Array<{ product: { id: number }; quantity: number; price: number; subitems?: FudoSubitem[] }>;
    customer?: { name: string; phone?: string };
    shippingCost?: number;
    discounts?: Array<{ amount: number }>;
    payment?: { total: number; paymentMethod?: { id: number } };
    comment?: string;
  };
}

/** `items[].subitems[]` del OpenAPI de Fudo. SIN VERIFICAR contra Fudo real (ENABLE_WRITES=false): ver docs/FUDO_INTEGRACION.md. */
export interface FudoSubitem {
  productId: number;
  productGroupId: number;
  quantity: number;
  price: number;
}

export type BuildResult = { ok: true; body: FudoOrderBody } | { ok: false; reason: string };

const clip = (value: string, max: number): string => (value.length > max ? `${value.slice(0, max - 1)}…` : value);
const round2 = (n: number): number => Math.round(n * 100) / 100;

type FudoItem = FudoOrderBody["order"]["items"][number];

/** Opciones utilizables: con producto y grupo de Fudo y cantidad válida. */
function usableOptions(options: OptionForFudo[] | null | undefined): Array<Required<Pick<OptionForFudo, "qty">> & { productId: number; groupId: number; price: number }> {
  return (options ?? []).flatMap((o) =>
    o.fudo_product_id != null && o.group_fudo_id != null && o.qty > 0
      ? [{ qty: o.qty, productId: o.fudo_product_id, groupId: o.group_fudo_id, price: round2(o.price ?? 0) }]
      : [],
  );
}

/**
 * Una línea sin opciones es un item. Una línea CON opciones se expande en `qty` items de cantidad 1, cada uno con
 * sus subitems (cantidad = la de la opción por unidad): así no depende de si Fudo multiplica los subitems por la
 * cantidad del item. El precio del item es el base (el `unit_price` de la línea menos lo que suman las opciones).
 */
function itemsFor(line: OrderForFudo["items"][number], fudoProductId: number): FudoItem[] {
  const options = usableOptions(line.fudo_options);
  if (options.length === 0) return [{ product: { id: fudoProductId }, quantity: line.qty, price: round2(line.unit_price) }];
  const extra = options.reduce((sum, o) => sum + o.price * o.qty, 0);
  const subitems: FudoSubitem[] = options.map((o) => ({ productId: o.productId, productGroupId: o.groupId, quantity: o.qty, price: o.price }));
  return Array.from({ length: line.qty }, () => ({
    product: { id: fudoProductId },
    quantity: 1,
    price: round2(line.unit_price - extra),
    subitems: subitems.map((s) => ({ ...s })),
  }));
}

export function buildFudoOrder(order: OrderForFudo, maps: FudoMaps): BuildResult {
  if (order.items.length === 0) return { ok: false, reason: "El pedido no tiene líneas guardadas (order_items)." };

  const unmapped = order.items.filter((i) => !i.product_id || !maps.products.has(i.product_id)).map((i) => i.name);
  if (unmapped.length > 0) return { ok: false, reason: `Productos sin mapear a Fudo: ${unmapped.join(", ")}` };

  const items = order.items.flatMap((i) => itemsFor(i, maps.products.get(i.product_id!)!));

  // El canje de puntos no viaja como línea: es la diferencia entre lo que suman las líneas + envío y el total cobrado.
  const subtotal = items.reduce(
    (sum, i) => sum + i.quantity * (i.price + (i.subitems ?? []).reduce((s, sub) => s + sub.price * sub.quantity, 0)),
    0,
  );
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
