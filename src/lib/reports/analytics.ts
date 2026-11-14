import type { ReportLine } from "./product-sales.ts";
import { computeDurations } from "../tracking.ts";
import { inBounds, localDateKey, type Bounds } from "./range.ts";

/** Pedido con solo lo que necesitan los informes. */
export interface ReportOrder {
  id: string;
  client_id: string | null;
  status: string;
  total: number;
  delivery_fee: number;
  channel: string;
  /** Canal dentro de Fudo (pedidosya, rappi, morfy, local); solo en pedidos con channel = 'fudo'. */
  fudo_source?: string | null;
  /** Tipo de venta en Fudo (DELIVERY, TAKEAWAY, EAT-IN); abre el canal local en delivery / take away / salón. */
  fudo_sale_type?: string | null;
  payment_method: string | null;
  /** Medios tal como figuran en Fudo, juntos en un texto. */
  fudo_payment?: string | null;
  /** Detalle de pagos de Fudo por medio y monto. */
  fudo_payments?: ReadonlyArray<{ name: string; amount: number }> | null;
  items_desc: string;
  /** Líneas guardadas (`order_items`). Si vienen, las ventas por producto se cuentan con ellas. */
  order_items?: ReadonlyArray<ReportLine> | null;
  created_at: string;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

const isCancelled = (o: ReportOrder) => o.status === "Cancelado";
const round = (n: number, decimals = 0) => Math.round(n * 10 ** decimals) / 10 ** decimals;

export type GroupBy = "none" | "day" | "channel" | "payment";

export interface SalesGroup {
  key: string;
  orders: number;
  revenue: number;
}

export interface SalesSummary {
  orders: number;
  revenue: number;
  avgTicket: number;
  deliveryFees: number;
  cancelled: number;
  cancellationRate: number;
  groups: SalesGroup[];
}

/** La app y Fudo escriben distinto el mismo medio: se agrupan bajo un solo nombre. */
const paymentLabel = (name: string): string => name.replace(/^mercado\s*pago$/i, "Mercado Pago");

/**
 * Cuánto entró por cada medio. Con detalle de Fudo reparte los pagos mixtos por su monto real.
 * Sin detalle, un pedido con varios medios queda con su nombre combinado: no se inventa el reparto.
 */
export function paymentShares(order: Pick<ReportOrder, "total" | "payment_method" | "fudo_payment" | "fudo_payments">): Array<{ name: string; amount: number }> {
  if (order.fudo_payments?.length) return order.fudo_payments.map((p) => ({ name: paymentLabel(p.name), amount: Number(p.amount) }));
  return [{ name: paymentLabel(order.payment_method ?? order.fudo_payment ?? "Sin dato"), amount: Number(order.total) }];
}

function groupKey(order: ReportOrder, groupBy: Exclude<GroupBy, "payment">): string {
  switch (groupBy) {
    case "day": return localDateKey(order.created_at);
    case "channel": return order.channel;
    case "none": return "total";
  }
}

/** Ventas del período. Los pedidos cancelados no suman ingresos: se cuentan aparte. */
export function salesSummary(orders: readonly ReportOrder[], bounds: Bounds, groupBy: GroupBy): SalesSummary {
  const inRange = orders.filter((o) => inBounds(o.created_at, bounds));
  const sold = inRange.filter((o) => !isCancelled(o));
  const cancelled = inRange.length - sold.length;
  const revenue = sold.reduce((sum, o) => sum + Number(o.total), 0);

  const buckets = new Map<string, SalesGroup>();
  if (groupBy !== "none") {
    for (const o of sold) {
      // Un pago mixto cuenta como pedido en cada medio, así que la suma de pedidos por medio puede superar el total.
      const shares = groupBy === "payment" ? paymentShares(o) : [{ name: groupKey(o, groupBy), amount: Number(o.total) }];
      for (const { name: key, amount } of shares) {
        const bucket = buckets.get(key) ?? { key, orders: 0, revenue: 0 };
        bucket.orders += 1;
        bucket.revenue += amount;
        buckets.set(key, bucket);
      }
    }
  }

  return {
    orders: sold.length,
    revenue,
    avgTicket: sold.length > 0 ? round(revenue / sold.length) : 0,
    deliveryFees: sold.reduce((sum, o) => sum + Number(o.delivery_fee), 0),
    cancelled,
    cancellationRate: inRange.length > 0 ? round(cancelled / inRange.length, 3) : 0,
    groups: [...buckets.values()].sort((a, b) => a.key.localeCompare(b.key)),
  };
}

export type { ProductSales, SalesRow, ComboRules } from "./product-sales.ts";
export { productSales, productSalesKey, buildComboRules, isComboCategory } from "./product-sales.ts";

export interface RecurringCustomer {
  name: string;
  orders: number;
  spent: number;
  lastOrderAt: string;
}

export function recurringCustomers(
  orders: readonly ReportOrder[],
  bounds: Bounds,
  clients: ReadonlyArray<{ id: string; name: string }>,
  minOrders: number,
): RecurringCustomer[] {
  const names = new Map(clients.map((c) => [c.id, c.name]));
  const byClient = new Map<string, RecurringCustomer>();

  for (const o of orders) {
    if (isCancelled(o) || !o.client_id || !inBounds(o.created_at, bounds)) continue;
    const entry = byClient.get(o.client_id) ?? {
      name: names.get(o.client_id) ?? "Cliente sin nombre", orders: 0, spent: 0, lastOrderAt: o.created_at,
    };
    entry.orders += 1;
    entry.spent += Number(o.total);
    if (o.created_at > entry.lastOrderAt) entry.lastOrderAt = o.created_at;
    byClient.set(o.client_id, entry);
  }

  return [...byClient.values()]
    .filter((c) => c.orders >= minOrders)
    .sort((a, b) => b.orders - a.orders || b.spent - a.spent || a.name.localeCompare(b.name));
}

export interface NewVsReturning {
  newCustomers: number;
  returningCustomers: number;
  ordersFromNew: number;
  ordersFromReturning: number;
}

/** "Nuevo" = su primer pedido de toda la historia cae dentro del período. */
export function newVsReturning(allOrders: readonly ReportOrder[], bounds: Bounds): NewVsReturning {
  const firstOrder = new Map<string, number>();
  for (const o of allOrders) {
    if (isCancelled(o) || !o.client_id) continue;
    const t = new Date(o.created_at).getTime();
    firstOrder.set(o.client_id, Math.min(firstOrder.get(o.client_id) ?? Infinity, t));
  }

  const from = new Date(bounds.from).getTime();
  const result: NewVsReturning = { newCustomers: 0, returningCustomers: 0, ordersFromNew: 0, ordersFromReturning: 0 };
  const seen = new Set<string>();

  for (const o of allOrders) {
    if (isCancelled(o) || !o.client_id || !inBounds(o.created_at, bounds)) continue;
    const isNew = (firstOrder.get(o.client_id) ?? 0) >= from;
    if (isNew) result.ordersFromNew += 1;
    else result.ordersFromReturning += 1;
    if (!seen.has(o.client_id)) {
      seen.add(o.client_id);
      if (isNew) result.newCustomers += 1;
      else result.returningCustomers += 1;
    }
  }
  return result;
}

export interface DeliveryTimes {
  delivered: number;
  avgKitchen: number | null;
  avgDispatchWait: number | null;
  avgRoute: number | null;
  avgTotal: number | null;
}

const average = (values: number[]): number | null =>
  values.length > 0 ? round(values.reduce((a, b) => a + b, 0) / values.length) : null;

/** Tiempos medios (minutos) de los pedidos entregados dentro del período. */
export function deliveryTimes(orders: readonly ReportOrder[], bounds: Bounds): DeliveryTimes {
  const delivered = orders.filter((o) => o.delivered_at && inBounds(o.delivered_at, bounds));
  const durations = delivered.map(computeDurations);
  const pick = (key: "kitchen" | "dispatchWait" | "route" | "total") =>
    average(durations.map((d) => d[key]).filter((v): v is number => v !== null));

  return {
    delivered: delivered.length,
    avgKitchen: pick("kitchen"),
    avgDispatchWait: pick("dispatchWait"),
    avgRoute: pick("route"),
    avgTotal: pick("total"),
  };
}

export interface ReviewsSummary {
  count: number;
  average: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  lowRated: number;
}

const LOW_RATING = 3;

export function reviewsSummary(
  reviews: ReadonlyArray<{ rating: number; created_at: string }>,
  bounds: Bounds,
): ReviewsSummary {
  const inRange = reviews.filter((r) => inBounds(r.created_at, bounds));
  const distribution: ReviewsSummary["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of inRange) {
    if (r.rating >= 1 && r.rating <= 5) distribution[r.rating as 1 | 2 | 3 | 4 | 5] += 1;
  }
  return {
    count: inRange.length,
    average: inRange.length > 0 ? round(inRange.reduce((s, r) => s + r.rating, 0) / inRange.length, 1) : null,
    distribution,
    lowRated: inRange.filter((r) => r.rating <= LOW_RATING).length,
  };
}
