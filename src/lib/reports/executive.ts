import { inBounds, localDateKey, type Bounds, type RangeKey } from "./range.ts";
import type { ReportOrder } from "./analytics.ts";
import { completedAt, durationStats, finishedStats, MAX_PLAUSIBLE_MINUTES, minutesBetween, preparedAt } from "./completion.ts";

/** Columnas de un pedido que realmente lee el tablero ejecutivo. */
export type ExecutiveOrder = Pick<
  ReportOrder,
  "id" | "status" | "total" | "channel" | "fudo_source" | "fudo_sale_type" | "created_at" | "ready_at" | "delivered_at"
> & { updated_at?: string | null; delivered_in_app?: boolean | null };
import {
  KPI_KEYS,
  isZoneVisible,
  kpiStatus,
  slaForZone,
  zoneLabel,
  type ExecutiveSettings,
  type GoodDirection,
  type KpiKey,
} from "./executiveSettings.ts";

/** Mismo corte que `LOW_RATING` de analytics.ts (ahí no se exporta): reseñas de 3 o menos son reclamos. */
export const LOW_RATING = 3;
/** Id que se usa para los pedidos que no caen en ninguna zona. */
export const NO_ZONE = "sin-zona";
/** Mínimo de pedidos de una zona para que el copiloto opine sobre ella. */
export const MIN_ZONE_SAMPLE = 3;

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const MAX_DAYS = 62;
const MAX_COMPLAINTS = 20;

export interface ReviewInput {
  rating: number;
  created_at: string;
  order_id?: string | null;
  comment?: string | null;
}

/** Resuelve la zona de un pedido (id) o null si no tiene. Se inyecta para no importar nada de servidor. */
export type ZoneOf = (order: ExecutiveOrder) => string | null;

export interface Kpis {
  orders: number;
  delivered: number;
  revenue: number;
  /** % de puntualidad sobre pedidos entregados más los atrasados (en curso fuera de plazo). */
  onTime: number | null;
  prepMinutes: number | null;
  /** % de pedidos con preparación medida que quedaron dentro de la meta de preparación. */
  prepOnTarget: number | null;
  /** Take away aparte: se mide de la carga al cierre, que no es una preparación de cocina. */
  takeawayMinutes: number | null;
  /** Minutos promedio del pedido a su cierre, en los que se pueden medir. */
  totalMinutes: number | null;
  csat: number | null;
  /** % de reseñas bajas sobre pedidos entregados. */
  complaints: number | null;
  avgTicket: number | null;
}

export interface Trend {
  delta: number | null;
  pct: number | null;
  direction: "up" | "down" | "flat";
  /** true si el cambio es favorable, false si es desfavorable, null si no hay cambio o dato. */
  good: boolean | null;
}

export interface DailyPoint { date: string; onTime: number | null; prepMinutes: number | null; orders: number }

export interface ZoneRow {
  zoneId: string;
  label: string;
  orders: number;
  revenue: number;
  onTime: number | null;
  previousOnTime: number | null;
  slaMinutes: number;
}

/**
 * Resultado de un canal de venta. `orders` y `revenue` excluyen cancelados; `cancelled` se cuenta aparte.
 * Los pedidos de Fudo se separan por su canal (pedidosya, rappi, morfy, local).
 */
export interface ChannelRow {
  channel: string;
  orders: number;
  delivered: number;
  cancelled: number;
  revenue: number;
  avgTicket: number | null;
  share: number;
}

/**
 * Tiempo de creación a cierre de un canal. En los pedidos de Fudo el cierre es el de caja, no la entrega real:
 * `source` lo distingue para que el tablero no lo presente como otra cosa.
 */
export interface ClosingTimeRow {
  channel: string;
  source: "cierre" | "entrega";
  /** Mediana en minutos; null si no hay pedidos medibles. */
  medianMinutes: number | null;
  measured: number;
  /** Cerrados después de MAX_PLAUSIBLE_MINUTES: suelen ser cierres de caja tardíos. */
  excluded: number;
  withoutTime: number;
  /** Take away y mostrador: se cargan al cobrar, así que su tiempo no dice nada. */
  notMeasurable: number;
}

export type Severity = "critical" | "warning" | "info";
export interface Insight { severity: Severity; text: string; action: string }

export interface ComplaintRow { orderId: string | null; rating: number; comment: string | null; createdAt: string }

const round = (n: number, decimals = 0) => Math.round(n * 10 ** decimals) / 10 ** decimals;
const isCancelled = (o: ExecutiveOrder) => o.status === "Cancelado";
const ms = (iso: string) => new Date(iso).getTime();
const pct = (part: number, total: number): number | null => (total > 0 ? round((part / total) * 100, 1) : null);
const zoneIdOf = (o: ExecutiveOrder, zoneOf: ZoneOf): string => zoneOf(o) ?? NO_ZONE;

const confirmedIn = (orders: readonly ExecutiveOrder[], bounds: Bounds): ExecutiveOrder[] =>
  orders.filter((o) => !isCancelled(o) && inBounds(o.created_at, bounds));

/** Período anterior de igual duración, pegado al actual. */
export function previousBounds(bounds: Bounds): Bounds {
  const from = ms(bounds.from);
  const length = ms(bounds.to) - from;
  return { from: new Date(from - length).toISOString(), to: bounds.from };
}

/** Fudo solo informa el cierre en caja; la entrega real es la que se confirma desde la app. */
const hasRealDelivery = (o: ExecutiveOrder): boolean => o.channel !== "fudo" || o.delivered_in_app === true;

/** Límite (ms epoch) para entregar un pedido: creación + SLA de su zona + tolerancia. */
function deadlineOf(order: ExecutiveOrder, settings: ExecutiveSettings, zoneOf: ZoneOf): number {
  const allowed = slaForZone(settings, zoneOf(order)) + settings.sla.toleranceMinutes;
  return ms(order.created_at) + allowed * MINUTE_MS;
}

/**
 * Puntualidad: el denominador son los pedidos entregados más los no entregados que ya superaron
 * su plazo (atrasados). Los pedidos en curso que todavía están en plazo no cuentan ni a favor ni en contra,
 * y tampoco los finalizados sin hora de cierre confiable: terminaron, pero no se sabe cuándo.
 * Los de Fudo quedan afuera: su hora es la del cierre en caja, no la de la entrega.
 */
function onTimePct(
  confirmed: readonly ExecutiveOrder[],
  settings: ExecutiveSettings,
  zoneOf: ZoneOf,
  now: number,
): number | null {
  let counted = 0;
  let onTime = 0;
  for (const o of confirmed.filter(hasRealDelivery)) {
    const deadline = deadlineOf(o, settings, zoneOf);
    const closedAt = completedAt(o);
    if (closedAt) {
      counted += 1;
      if (ms(closedAt) <= deadline) onTime += 1;
    } else if (o.status !== "Finalizados" && now > deadline) {
      counted += 1;
    }
  }
  return pct(onTime, counted);
}

const isNum = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
const totalOf = (o: ExecutiveOrder): number => {
  const n = Number(o.total);
  return Number.isFinite(n) ? n : 0;
};
const sumTotals = (list: readonly ExecutiveOrder[]): number => list.reduce((sum, o) => sum + totalOf(o), 0);

const isTakeaway = (o: ExecutiveOrder): boolean => o.fudo_sale_type === "TAKEAWAY";
/** PedidosYa y Rappi pasan por su integración: Fudo no informa cuándo estuvo listo el pedido. */
const isExternalIntegration = (o: ExecutiveOrder): boolean => o.fudo_source === "pedidosya" || o.fudo_source === "rappi";

function takeawayAverage(confirmed: readonly ExecutiveOrder[]): number | null {
  const minutes = confirmed
    .filter(isTakeaway)
    .map((o) => minutesBetween(o.created_at, preparedAt(o)))
    .filter((m): m is number => m !== null);
  return durationStats(minutes, 0).avgMinutes;
}

function prepStats(confirmed: readonly ExecutiveOrder[], targetMinutes: number) {
  const minutes = confirmed
    .filter((o) => !isTakeaway(o) && !isExternalIntegration(o))
    .map((o) => minutesBetween(o.created_at, preparedAt(o)))
    .filter((m): m is number => m !== null);
  return durationStats(minutes, targetMinutes);
}

export function computeKpis(
  orders: readonly ExecutiveOrder[],
  reviews: readonly ReviewInput[],
  bounds: Bounds,
  settings: ExecutiveSettings,
  zoneOf: ZoneOf,
  now: number = Date.now(),
): Kpis {
  const confirmed = confirmedIn(orders, bounds);
  const delivered = confirmed.filter((o) => o.delivered_at);
  const ratings = reviews.filter((r) => inBounds(r.created_at, bounds) && isNum(r.rating));
  const priced = confirmed.filter((o) => Number.isFinite(Number(o.total)));
  const revenue = sumTotals(confirmed);
  const prep = prepStats(confirmed, settings.kpis.prepMinutes.target);
  // Reclamos: solo cuentan reseñas bajas ligadas (order_id) a un pedido entregado del período.
  // Las reseñas sin order_id no cuentan para reclamos. Se cuenta cada pedido una sola vez.
  const deliveredIds = new Set(delivered.map((o) => o.id));
  const complained = new Set(
    ratings.filter((r) => r.rating <= LOW_RATING && r.order_id != null && deliveredIds.has(r.order_id)).map((r) => r.order_id),
  );

  return {
    orders: confirmed.length,
    delivered: delivered.length,
    revenue,
    onTime: onTimePct(confirmed, settings, zoneOf, now),
    prepMinutes: prep.avgMinutes,
    prepOnTarget: prep.onTargetPct,
    takeawayMinutes: takeawayAverage(confirmed),
    // El objetivo no importa acá: solo se usa el promedio.
    totalMinutes: finishedStats(confirmed.filter(hasRealDelivery), 0).avgMinutes,
    csat: ratings.length > 0 ? round(ratings.reduce((s, r) => s + r.rating, 0) / ratings.length, 2) : null,
    complaints: pct(complained.size, delivered.length),
    avgTicket: priced.length > 0 ? round(revenue / priced.length) : null,
  };
}

const NO_TREND: Trend = { delta: null, pct: null, direction: "flat", good: null };

/** Variación contra el período anterior y si es favorable según el sentido bueno del KPI. */
export function trend(current: number | null, previous: number | null, goodDirection: GoodDirection): Trend {
  if (current === null || previous === null) return NO_TREND;
  const delta = round(current - previous, 2);
  if (delta === 0) return { delta: 0, pct: 0, direction: "flat", good: null };
  return {
    delta,
    pct: previous !== 0 ? round((delta / previous) * 100, 1) : null,
    direction: delta > 0 ? "up" : "down",
    good: delta > 0 === (goodDirection === "higher"),
  };
}

/** Puntualidad y preparación día por día (hora de Buenos Aires). Los días sin pedidos quedan en null. */
export function dailySeries(
  orders: readonly ExecutiveOrder[],
  bounds: Bounds,
  settings: ExecutiveSettings,
  zoneOf: ZoneOf,
  now: number = Date.now(),
): DailyPoint[] {
  const byDay = new Map<string, ExecutiveOrder[]>();
  for (const o of confirmedIn(orders, bounds)) {
    const key = localDateKey(o.created_at);
    const bucket = byDay.get(key);
    if (bucket) bucket.push(o);
    else byDay.set(key, [o]);
  }

  const points: DailyPoint[] = [];
  const end = ms(bounds.to);
  for (let t = ms(bounds.from); t < end && points.length < MAX_DAYS; t += DAY_MS) {
    const date = localDateKey(new Date(t).toISOString());
    const day = byDay.get(date) ?? [];
    points.push({ date, onTime: onTimePct(day, settings, zoneOf, now), prepMinutes: prepStats(day, settings.kpis.prepMinutes.target).avgMinutes, orders: day.length });
  }
  return points;
}

/** Demanda, facturación y puntualidad por zona. Oculta las zonas que los ajustes marcan como no visibles. */
export function byZone(
  orders: readonly ExecutiveOrder[],
  bounds: Bounds,
  settings: ExecutiveSettings,
  zoneOf: ZoneOf,
  names: Readonly<Record<string, string>> = {},
  now: number = Date.now(),
): ZoneRow[] {
  const groupByZone = (list: readonly ExecutiveOrder[]) => {
    const groups = new Map<string, ExecutiveOrder[]>();
    for (const o of list) {
      const id = zoneIdOf(o, zoneOf);
      const bucket = groups.get(id);
      if (bucket) bucket.push(o);
      else groups.set(id, [o]);
    }
    return groups;
  };
  const current = groupByZone(confirmedIn(orders, bounds));
  const previous = groupByZone(confirmedIn(orders, previousBounds(bounds)));

  return [...current.entries()]
    .filter(([id]) => isZoneVisible(settings, id))
    .map(([id, list]) => ({
      zoneId: id,
      label: id === NO_ZONE ? "Sin zona" : zoneLabel(settings, id, names),
      orders: list.length,
      revenue: sumTotals(list),
      onTime: onTimePct(list, settings, zoneOf, now),
      previousOnTime: onTimePct(previous.get(id) ?? [], settings, zoneOf, now),
      slaMinutes: slaForZone(settings, id),
    }))
    .sort((a, b) => b.orders - a.orders || a.zoneId.localeCompare(b.zoneId));
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return round(sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2, 1);
}

const isPickup = (o: ExecutiveOrder): boolean => o.fudo_sale_type === "TAKEAWAY" || o.channel === "mostrador";

/** Mediana de creación a cierre por canal. Primero los canales medibles, los de más pedidos arriba. */
export function closingTimesByChannel(orders: readonly ExecutiveOrder[], bounds: Bounds): ClosingTimeRow[] {
  const groups = new Map<string, { row: ClosingTimeRow; minutes: number[] }>();
  for (const o of orders) {
    if (o.status !== "Finalizados" || !inBounds(o.created_at, bounds)) continue;
    const key = channelOf(o);
    const group = groups.get(key) ?? {
      row: { channel: key, source: o.channel === "fudo" ? "cierre" : "entrega", medianMinutes: null, measured: 0, excluded: 0, withoutTime: 0, notMeasurable: 0 },
      minutes: [],
    };
    groups.set(key, group);
    if (isPickup(o)) {
      group.row.notMeasurable += 1;
      continue;
    }
    const minutes = minutesBetween(o.created_at, o.delivered_at);
    if (minutes === null) group.row.withoutTime += 1;
    else if (minutes > MAX_PLAUSIBLE_MINUTES) group.row.excluded += 1;
    else group.minutes.push(minutes);
  }
  return [...groups.values()]
    .map(({ row, minutes }) => ({ ...row, medianMinutes: median(minutes), measured: minutes.length }))
    .sort((a, b) => b.measured - a.measured || a.notMeasurable - b.notMeasurable || a.channel.localeCompare(b.channel));
}

/** Canal de un pedido: los de Fudo se abren por su origen (PedidosYa, Rappi, Morfy o local). */
const SALE_TYPE_KEY: Readonly<Record<string, string>> = { DELIVERY: "delivery", TAKEAWAY: "takeaway", "EAT-IN": "salon" };

export const channelOf = (o: ExecutiveOrder): string => {
  if (o.channel !== "fudo") return o.channel;
  const source = o.fudo_source || "fudo";
  if (source !== "local" && source !== "fudo") return source;
  const sub = o.fudo_sale_type ? SALE_TYPE_KEY[o.fudo_sale_type] : undefined;
  return sub ? `local_${sub}` : source;
};

export function byChannel(orders: readonly ExecutiveOrder[], bounds: Bounds): ChannelRow[] {
  const inRange = orders.filter((o) => inBounds(o.created_at, bounds));
  const confirmed = inRange.filter((o) => !isCancelled(o));
  const rows = new Map<string, ChannelRow>();
  for (const o of inRange) {
    const key = channelOf(o);
    const row = rows.get(key) ?? { channel: key, orders: 0, delivered: 0, cancelled: 0, revenue: 0, avgTicket: null, share: 0 };
    rows.set(
      key,
      isCancelled(o)
        ? { ...row, cancelled: row.cancelled + 1 }
        : { ...row, orders: row.orders + 1, delivered: row.delivered + (o.delivered_at ? 1 : 0), revenue: row.revenue + totalOf(o) },
    );
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      avgTicket: r.orders > 0 ? round(r.revenue / r.orders) : null,
      share: pct(r.orders, confirmed.length) ?? 0,
    }))
    .sort((a, b) => b.orders - a.orders || a.channel.localeCompare(b.channel));
}

const KPI_LABELS: Record<KpiKey, string> = {
  onTime: "Entregas a tiempo",
  prepMinutes: "Tiempo de preparación",
  csat: "Satisfacción (CSAT)",
  complaints: "Reclamos",
  avgTicket: "Ticket promedio",
};

const KPI_ACTIONS: Record<KpiKey, string> = {
  onTime: "Revisá la dotación de repartidores y los tiempos prometidos por zona.",
  prepMinutes: "Mirá la carga de la cocina en los horarios pico y reforzá el turno.",
  csat: "Leé las reseñas bajas y hablá con los clientes afectados.",
  complaints: "Revisá los reclamos recientes y definí una compensación.",
  avgTicket: "Probá combos o sugerencias de adicionales para subir el ticket.",
};

function formatKpi(key: KpiKey, value: number): string {
  switch (key) {
    case "onTime":
    case "complaints": return `${value}%`;
    case "prepMinutes": return `${value} min`;
    case "csat": return String(value);
    case "avgTicket": return `$ ${value.toLocaleString("es-AR")}`;
  }
}

const SEVERITY_ORDER: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

function kpiInsights(snapshot: InsightInput, settings: ExecutiveSettings): Insight[] {
  const out: Insight[] = [];
  for (const key of KPI_KEYS) {
    const setting = settings.kpis[key];
    const value = snapshot.kpis.current[key];
    if (!setting.visible || value === null) continue;
    const status = kpiStatus(setting, value);
    const label = KPI_LABELS[key];
    if (status === "alert" && settings.copilot.rules.kpiAlert) {
      out.push({ severity: "critical", text: `${label} está en ${formatKpi(key, value)} y pasó el umbral de alerta (${formatKpi(key, setting.alertThreshold)}).`, action: KPI_ACTIONS[key] });
    } else if (status === "miss" && settings.copilot.rules.kpiMiss) {
      out.push({ severity: "warning", text: `${label} está en ${formatKpi(key, value)} y no llega a la meta (${formatKpi(key, setting.target)}).`, action: KPI_ACTIONS[key] });
    }
  }
  return out;
}

function zoneInsights(snapshot: InsightInput, settings: ExecutiveSettings): Insight[] {
  const out: Insight[] = [];
  const { rules, dropPoints } = settings.copilot;
  for (const zone of snapshot.zones) {
    if (zone.onTime === null || zone.orders < MIN_ZONE_SAMPLE) continue;
    const isAlert = kpiStatus(settings.kpis.onTime, zone.onTime) === "alert";
    const dropped = zone.previousOnTime !== null && zone.previousOnTime - zone.onTime >= dropPoints;
    if (dropped && rules.zoneDrop) {
      out.push({
        severity: isAlert ? "critical" : "warning",
        text: `La puntualidad en ${zone.label} cayó al ${zone.onTime}% (venía de ${zone.previousOnTime}%).`,
        action: `Revisá los repartidores asignados a ${zone.label} y si el tiempo prometido (${zone.slaMinutes} min) es realista.`,
      });
    } else if (isAlert && rules.zoneLate) {
      out.push({
        severity: "warning",
        text: `La puntualidad en ${zone.label} está en ${zone.onTime}%, por debajo del umbral de alerta.`,
        action: `Evaluá reforzar repartidores en ${zone.label} o ajustar su tiempo prometido.`,
      });
    }
  }
  return out;
}

type InsightInput = Pick<ExecutiveSnapshot, "kpis" | "zones">;

/** Reglas del copiloto: deterministas, sin LLM, y gobernadas por los ajustes. */
export function buildInsights(snapshot: InsightInput, settings: ExecutiveSettings): Insight[] {
  if (snapshot.kpis.current.orders === 0) {
    return [{ severity: "info", text: "Todavía no hay pedidos en este período.", action: "Probá con un rango más amplio." }];
  }
  const found = [...kpiInsights(snapshot, settings), ...zoneInsights(snapshot, settings)]
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
  if (found.length > 0) return found;
  return [{ severity: "info", text: "Todo en orden: los indicadores están dentro de las metas.", action: "Seguí así. Revisá de nuevo después del pico de la noche." }];
}

export interface SnapshotInput {
  orders: readonly ExecutiveOrder[];
  reviews: readonly ReviewInput[];
  bounds: Bounds;
  settings: ExecutiveSettings;
  zoneOf: ZoneOf;
  rangeKey?: RangeKey | null;
  /** Id de zona para filtrar KPIs, series y canales; null o ausente = todas. */
  zone?: string | null;
  /** Nombres reales de las zonas por id (ej. {Z1: "Centro"}). */
  zoneNames?: Readonly<Record<string, string>>;
  /** Instante de referencia para detectar pedidos atrasados (por defecto, ahora). */
  now?: Date | number;
  /** true si la lectura de datos llegó al tope y puede faltar información. */
  truncated?: boolean;
}

export interface ExecutiveSnapshot {
  range: { key: RangeKey | null; from: string; to: string };
  previous: Bounds;
  zone: string | null;
  kpis: { current: Kpis; previous: Kpis };
  trends: Record<KpiKey, Trend>;
  series: DailyPoint[];
  zones: ZoneRow[];
  zoneOptions: Array<{ id: string; label: string }>;
  channels: ChannelRow[];
  closingTimes: ClosingTimeRow[];
  complaints: ComplaintRow[];
  insights: Insight[];
  /** true si los datos se cortaron al llegar al tope de lectura (el tablero puede estar incompleto). */
  truncated: boolean;
}

function scopeToZone(
  input: SnapshotInput,
): { orders: readonly ExecutiveOrder[]; reviews: readonly ReviewInput[] } {
  const { zone, zoneOf } = input;
  if (!zone) return { orders: input.orders, reviews: input.reviews };
  const orders = input.orders.filter((o) => zoneIdOf(o, zoneOf) === zone);
  const ids = new Set(orders.map((o) => o.id));
  return { orders, reviews: input.reviews.filter((r) => r.order_id != null && ids.has(r.order_id)) };
}

function zoneOptions(input: SnapshotInput, zones: readonly ZoneRow[]) {
  const ids = new Set([...Object.keys(input.zoneNames ?? {}), ...zones.map((z) => z.zoneId)]);
  return [...ids]
    .filter((id) => isZoneVisible(input.settings, id))
    .map((id) => ({ id, label: id === NO_ZONE ? "Sin zona" : zoneLabel(input.settings, id, input.zoneNames) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function complaintRows(reviews: readonly ReviewInput[], bounds: Bounds): ComplaintRow[] {
  return reviews
    .filter((r) => isNum(r.rating) && r.rating <= LOW_RATING && inBounds(r.created_at, bounds))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, MAX_COMPLAINTS)
    .map((r) => ({ orderId: r.order_id ?? null, rating: r.rating, comment: r.comment ?? null, createdAt: r.created_at }));
}

/** Arma la respuesta completa de la API del tablero ejecutivo. */
export function buildExecutiveSnapshot(input: SnapshotInput): ExecutiveSnapshot {
  const { bounds, settings, zoneOf } = input;
  const prev = previousBounds(bounds);
  const scoped = scopeToZone(input);
  const now = input.now === undefined ? Date.now() : Number(input.now);
  const current = computeKpis(scoped.orders, scoped.reviews, bounds, settings, zoneOf, now);
  const previous = computeKpis(scoped.orders, scoped.reviews, prev, settings, zoneOf, now);
  const zones = byZone(input.orders, bounds, settings, zoneOf, input.zoneNames, now);

  const trends = Object.fromEntries(
    KPI_KEYS.map((k) => [k, trend(current[k], previous[k], settings.kpis[k].direction)]),
  ) as Record<KpiKey, Trend>;

  return {
    range: { key: input.rangeKey ?? null, from: bounds.from, to: bounds.to },
    previous: prev,
    zone: input.zone ?? null,
    kpis: { current, previous },
    trends,
    series: dailySeries(scoped.orders, bounds, settings, zoneOf, now),
    zones,
    zoneOptions: zoneOptions(input, zones),
    channels: byChannel(scoped.orders, bounds),
    closingTimes: closingTimesByChannel(scoped.orders, bounds),
    complaints: complaintRows(scoped.reviews, bounds),
    insights: buildInsights({ kpis: { current, previous }, zones }, settings),
    truncated: input.truncated === true,
  };
}
