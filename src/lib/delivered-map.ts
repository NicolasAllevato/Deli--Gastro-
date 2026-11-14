import { deliveredPoint } from "./delivery-metrics.ts";
import { startOfDayAR, startOfDayKeyAR } from "./time-ar.ts";

/** Vista de pedidos entregados del mapa: filtros, conteos y agrupación de marcadores. Sin I/O. */

export const DELIVERED_CHANNELS = [
  { value: "delivery_local", label: "Delivery local" },
  { value: "web", label: "Web / WhatsApp" },
  { value: "pedidosya", label: "PedidosYa" },
  { value: "rappi", label: "Rappi" },
  { value: "morfy", label: "Morfy" },
] as const;

export type DeliveredChannel = (typeof DELIVERED_CHANNELS)[number]["value"];

/** Color y letra del punto de cada canal; la leyenda usa los mismos para que se lea el mapa. */
export const CHANNEL_MARKER: Readonly<Record<DeliveredChannel, { color: string; letter: string }>> = {
  delivery_local: { color: "#475569", letter: "L" },
  web: { color: "#2563eb", letter: "W" },
  pedidosya: { color: "#dc2626", letter: "P" },
  rappi: { color: "#ea580c", letter: "R" },
  morfy: { color: "#a16207", letter: "M" },
};

export function channelLabel(channel: DeliveredChannel): string {
  return DELIVERED_CHANNELS.find((c) => c.value === channel)?.label ?? channel;
}

export interface DeliveredChannelCount {
  channel: DeliveredChannel;
  total: number;
  located: number;
}
export type DeliveredPreset = "hoy" | "7d" | "30d" | "custom";

/** Valor del filtro para los pedidos sin repartidor asignado. */
export const NO_COURIER = "__sin_repartidor__";
export const ALL = "todos";

export const MAX_RANGE_DAYS = 93;
export const MAX_MARKERS = 2000;
export const LIST_LIMIT = 50;
/** Con menos puntos que esto no se agrupan: se ven uno por uno. */
export const CLUSTER_MIN_POINTS = 40;
const CLUSTER_MAX_ZOOM = 17;
const CLUSTER_CELL_PX = 56;
const DAY_MS = 86_400_000;

export interface DeliveredRow {
  id: string;
  client_id: string | null;
  customer_name: string | null;
  status: string;
  channel: string | null;
  fudo_sale_type: string | null;
  fudo_source: string | null;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  delivered_lat: number | null;
  delivered_lng: number | null;
  courier_name: string | null;
  created_at: string;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export interface DeliveredItem extends Omit<DeliveredRow, "client_id" | "customer_name"> {
  client_name: string;
}

export interface DeliveredFilters {
  from: string;
  to: string;
  channel: DeliveredChannel | typeof ALL;
  courier: string;
}

export interface DeliveredSummary {
  total: number;
  located: number;
  withoutLocation: number;
  /** Parte de `withoutLocation` que ni siquiera tiene dirección (PedidosYa, Rappi, ventas viejas). */
  withoutAddress: number;
}

export interface DeliveredMapResponse {
  summary: DeliveredSummary;
  couriers: string[];
  /** Solo los canales con pedidos en el resultado. */
  channels: DeliveredChannelCount[];
  markers: DeliveredItem[];
  list: DeliveredItem[];
  /** La cantidad de pedidos del rango superó lo que se puede leer: los números son un piso. */
  truncated: boolean;
}

/** Pedido con envío: excluye mostrador y take away. */
export function isDeliveryOrder(o: Pick<DeliveredRow, "channel" | "fudo_sale_type" | "delivery_address" | "delivered_lat" | "delivered_lng" | "delivery_lat" | "delivery_lng">): boolean {
  if (o.channel === "mostrador" || o.fudo_sale_type === "TAKEAWAY") return false;
  return o.fudo_sale_type === "DELIVERY" || Boolean(o.delivery_address) || deliveredPoint(o) !== null;
}

export function deliveredChannel(o: Pick<DeliveredRow, "channel" | "fudo_source">): DeliveredChannel {
  if (o.channel !== "fudo") return "web";
  if (o.fudo_source === "pedidosya" || o.fudo_source === "rappi" || o.fudo_source === "morfy") return o.fudo_source;
  return "delivery_local";
}

/** Muchas ventas viejas de Fudo no tienen hora de cierre: para ubicarlas en el tiempo vale la de creación. */
export function effectiveDeliveredAt(o: Pick<DeliveredRow, "delivered_at" | "created_at">): string {
  return o.delivered_at ?? o.created_at;
}

/**
 * Rango [from, to) de días argentinos (antes: hora local del navegador, que
 * fallaba fuera de Argentina); `null` si el personalizado está incompleto o es inválido.
 */
export function rangeForPreset(preset: DeliveredPreset, now: Date, custom: { from: string; to: string } = { from: "", to: "" }): { from: string; to: string } | null {
  const tomorrow = startOfDayAR(now, 1).toISOString();
  if (preset === "hoy") return { from: startOfDayAR(now).toISOString(), to: tomorrow };
  if (preset === "7d") return { from: startOfDayAR(now, -6).toISOString(), to: tomorrow };
  if (preset === "30d") return { from: startOfDayAR(now, -29).toISOString(), to: tomorrow };
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
  if (!valid(custom.from) || !valid(custom.to)) return null;
  const from = startOfDayKeyAR(custom.from).toISOString();
  const to = startOfDayKeyAR(custom.to, 1).toISOString();
  return isValidRange(from, to) ? { from, to } : null;
}

export function isValidRange(from: string, to: string): boolean {
  const span = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(span) && span > 0 && span <= (MAX_RANGE_DAYS + 1) * DAY_MS;
}

function matchesCourier(o: DeliveredRow, courier: string): boolean {
  if (courier === ALL) return true;
  return courier === NO_COURIER ? !o.courier_name : o.courier_name === courier;
}

export interface DeliveredSelection {
  channels: DeliveredChannelCount[];
  summary: DeliveredSummary;
  couriers: string[];
  /** Filtrados, más recientes primero. */
  rows: DeliveredRow[];
}

/** Aplica los filtros sobre todo lo leído; los conteos salen del total, no de lo que entra en el mapa. */
export function selectDelivered(all: readonly DeliveredRow[], filters: DeliveredFilters): DeliveredSelection {
  const from = new Date(filters.from).getTime();
  const to = new Date(filters.to).getTime();
  const inScope = all.filter((o) => {
    const at = new Date(effectiveDeliveredAt(o)).getTime();
    return o.status === "Finalizados" && at >= from && at < to && isDeliveryOrder(o) && (filters.channel === ALL || deliveredChannel(o) === filters.channel);
  });
  const rows = inScope
    .filter((o) => matchesCourier(o, filters.courier))
    .sort((a, b) => effectiveDeliveredAt(b).localeCompare(effectiveDeliveredAt(a)) || b.id.localeCompare(a.id));
  const located = rows.filter((o) => deliveredPoint(o) !== null).length;
  return {
    summary: {
      total: rows.length,
      located,
      withoutLocation: rows.length - located,
      withoutAddress: rows.filter((o) => deliveredPoint(o) === null && !o.delivery_address?.trim()).length,
    },
    channels: DELIVERED_CHANNELS.map(({ value }) => {
      const ofChannel = rows.filter((o) => deliveredChannel(o) === value);
      return { channel: value, total: ofChannel.length, located: ofChannel.filter((o) => deliveredPoint(o) !== null).length };
    }).filter((c) => c.total > 0),
    couriers: [...new Set(inScope.map((o) => o.courier_name).filter((n): n is string => Boolean(n)))].sort((a, b) => a.localeCompare(b, "es")),
    rows,
  };
}

export interface MapPoint {
  lat: number;
  lng: number;
}

export interface MarkerGroup<T> {
  key: string;
  lat: number;
  lng: number;
  items: T[];
}

/** Agrupa por grilla de píxeles según el zoom. Sin agrupar con pocos puntos o de muy cerca. */
export function clusterPoints<T>(items: readonly T[], pointOf: (item: T) => MapPoint | null, zoom: number): MarkerGroup<T>[] {
  const scale = 256 * 2 ** zoom;
  const group = items.length >= CLUSTER_MIN_POINTS && zoom < CLUSTER_MAX_ZOOM;
  const cells = new Map<string, { items: T[]; points: MapPoint[] }>();
  items.forEach((item, index) => {
    const p = pointOf(item);
    if (!p) return;
    const sin = Math.sin((p.lat * Math.PI) / 180);
    const x = ((p.lng + 180) / 360) * scale;
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
    const key = group ? `${Math.floor(x / CLUSTER_CELL_PX)}:${Math.floor(y / CLUSTER_CELL_PX)}` : `p${index}`;
    const cell = cells.get(key) ?? { items: [], points: [] };
    cells.set(key, { items: [...cell.items, item], points: [...cell.points, p] });
  });
  return [...cells].map(([key, cell]) => ({
    key,
    lat: cell.points.reduce((sum, p) => sum + p.lat, 0) / cell.points.length,
    lng: cell.points.reduce((sum, p) => sum + p.lng, 0) / cell.points.length,
    items: cell.items,
  }));
}
