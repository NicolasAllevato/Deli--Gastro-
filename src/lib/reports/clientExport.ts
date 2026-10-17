import { parseItems } from "../orders.ts";
import type { ReportOrder } from "./analytics.ts";
import { inBounds, type Bounds } from "./range.ts";

/** Datos de un cliente tal como se exportan. */
export interface ExportClient {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  tier: string;
  total_points: number;
  wa_marketing_opt_in: boolean;
  created_at: string;
}

export interface ClientSummary {
  name: string;
  phone: string;
  address: string;
  tier: string;
  points: number;
  whatsappOptIn: boolean;
  createdAt: string;
  orders: number;
  cancelled: number;
  spent: number;
  avgTicket: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  daysSinceLast: number | null;
  topProduct: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

interface Acc {
  orders: number;
  cancelled: number;
  spent: number;
  first: string | null;
  last: string | null;
  units: Map<string, number>;
}

const emptyAcc = (): Acc => ({ orders: 0, cancelled: 0, spent: 0, first: null, last: null, units: new Map() });

function topProductOf(units: ReadonlyMap<string, number>): string {
  let best = "";
  let bestUnits = 0;
  for (const [name, qty] of units) {
    if (qty > bestUnits || (qty === bestUnits && name.localeCompare(best) < 0)) {
      best = name;
      bestUnits = qty;
    }
  }
  return best;
}

/**
 * Resumen por cliente (incluye los que no tienen pedidos). Con `bounds`, pedidos, cancelados,
 * gasto, ticket y producto más pedido son del período; con `null`, de todo el histórico.
 * Primer pedido, último pedido y días de inactividad son siempre históricos.
 * Los cancelados no suman gasto.
 */
export function clientSummaries(
  clients: readonly ExportClient[],
  orders: readonly ReportOrder[],
  bounds: Bounds | null,
  now: Date = new Date(),
): ClientSummary[] {
  const byClient = new Map<string, Acc>(clients.map((c) => [c.id, emptyAcc()]));

  for (const o of orders) {
    const acc = o.client_id ? byClient.get(o.client_id) : undefined;
    if (!acc) continue;
    const cancelled = o.status === "Cancelado";
    // Primer y último pedido salen siempre del histórico: si no, quien pidió ayer figuraría
    // como inactivo al exportar "mes pasado".
    if (!cancelled) {
      if (acc.first === null || o.created_at < acc.first) acc.first = o.created_at;
      if (acc.last === null || o.created_at > acc.last) acc.last = o.created_at;
    }
    if (bounds && !inBounds(o.created_at, bounds)) continue;
    if (cancelled) {
      acc.cancelled += 1;
      continue;
    }
    acc.orders += 1;
    acc.spent += Number(o.total);
    for (const line of parseItems(o.items_desc)) acc.units.set(line.name, (acc.units.get(line.name) ?? 0) + line.qty);
  }

  return clients
    .map((c): ClientSummary => {
      const a = byClient.get(c.id)!;
      return {
        name: c.name,
        phone: c.phone ?? "",
        address: c.address ?? "",
        tier: c.tier,
        points: c.total_points,
        whatsappOptIn: c.wa_marketing_opt_in,
        createdAt: c.created_at,
        orders: a.orders,
        cancelled: a.cancelled,
        spent: a.spent,
        avgTicket: a.orders > 0 ? Math.round(a.spent / a.orders) : 0,
        firstOrderAt: a.first,
        lastOrderAt: a.last,
        daysSinceLast: a.last ? Math.max(0, Math.floor((now.getTime() - new Date(a.last).getTime()) / DAY_MS)) : null,
        topProduct: topProductOf(a.units),
      };
    })
    .sort((x, y) => y.spent - x.spent || x.name.localeCompare(y.name));
}
