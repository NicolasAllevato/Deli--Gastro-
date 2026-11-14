import type { Row, TableName, Tables } from "@/lib/demo/seed";
import { parseOrFilter, type OrNode } from "../or-filter.ts";

/**
 * Motor de consultas mínimo, compatible con el subconjunto de la API de
 * supabase-js que usa esta app (select/insert/update/upsert/delete + filtros).
 * Un `QueryPlan` es serializable: el navegador lo envía a /api/demo/query y el
 * servidor lo ejecuta contra el store.
 */

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "ilike" | "like" | "not" | "or";

export interface Filter {
  op: FilterOp;
  column: string;
  value: unknown;
}

export interface QueryPlan {
  table: TableName;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  columns: string;
  filters: Filter[];
  order: Array<{ column: string; ascending: boolean }>;
  limit: number | null;
  /** Filas a saltear antes de `limit` (`.range(from, to)` de PostgREST). */
  offset?: number;
  payload: unknown;
  onConflict: string;
  returning: boolean;
  count: boolean;
  head: boolean;
  single: "none" | "single" | "maybe";
}

export interface QueryError {
  message: string;
  code: string;
}

export interface QueryResult {
  data: unknown;
  error: QueryError | null;
  count: number | null;
}

const KNOWN_TABLES: readonly TableName[] = [
  "clients", "orders", "points_ledger", "global_config", "categories", "products", "reviews", "order_events",
  "delivery_zones", "integration_secrets", "wa_conversations", "wa_messages", "wa_campaigns", "legal_acceptances",
  "payment_intents", "order_items", "courier_locations", "couriers",
  "fudo_product_map", "fudo_payment_map",
];

/** Tablas cuya clave primaria es `key` (no `id`). */
const KEY_TABLES: readonly TableName[] = ["global_config", "integration_secrets"];

/** Tablas sin `updated_at` (solo se agregan filas). */
const APPEND_ONLY: readonly TableName[] = ["points_ledger", "reviews", "order_events", "wa_messages", "legal_acceptances", "order_items"];

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULTS: Record<TableName, () => Row> = {
  legal_acceptances: () => ({ email: null, role: null, ip: null, user_agent: null, accepted_at: nowIso() }),
  payment_intents: () => ({
    status: "pending", mp_preference_id: null, checkout_url: null, mp_payment_id: null, order_id: null, refund_error: null,
  }),
  clients: () => ({
    user_id: null, phone: null, address: null, tier: "Bronce", total_points: 0, wa_marketing_opt_in: false,
  }),
  orders: () => ({
    client_id: null, status: "Recibidos", delivery_fee: 0, delivery_address: null,
    delivery_lat: null, delivery_lng: null, payment_method: null, notes: null, courier_name: null,
    channel: "web", accepted_at: null, ready_at: null, picked_up_at: null, delivered_at: null,
    survey_sent_at: null, fudo_order_id: null, fudo_sync_status: null, fudo_error: null,
    fudo_attempts: 0, fudo_synced_at: null, delivered_lat: null, delivered_lng: null, delivered_accuracy_m: null,
    fudo_sale_type: null, fudo_sale_state: null, fudo_source: null, fudo_payment: null, fudo_payments: null, customer_name: null, delivered_in_app: false, geocode_attempts: 0,
  }),
  points_ledger: () => ({ order_id: null }),
  global_config: () => ({}),
  categories: () => ({ description: "", is_active: true, fudo_id: null, source: "manual", fudo_synced_at: null }),
  products: () => ({ category_id: null, description: "", image_url: "", is_active: true, fudo_id: null, source: "manual", fudo_synced_at: null }),
  reviews: () => ({ feedback: null }),
  order_events: () => ({ actor: null, detail: null }),
  order_items: () => ({ product_id: null }),
  courier_locations: () => ({ accuracy_m: null, heading: null, speed_mps: null }),
  couriers: () => ({ active: true }),
  fudo_product_map: () => ({ fudo_name: null, updated_at: nowIso() }),
  fudo_payment_map: () => ({ updated_at: nowIso() }),
  delivery_zones: () => ({ fee: 0, min_order: 0, sort_order: 0, is_active: true }),
  integration_secrets: () => ({}),
  wa_conversations: () => ({
    client_id: null, contact_name: null, state: {}, human_takeover: false, last_inbound_at: null,
  }),
  wa_messages: () => ({ wamid: null, body: null, status: null, tokens: null }),
  wa_campaigns: () => ({ status: "sending", recipients: 0, sent: 0, failed: 0, finished_at: null }),
};

function compare(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.column];
  switch (f.op) {
    case "eq": return v === f.value;
    case "neq": return v !== f.value;
    case "gt": return compare(v, f.value) > 0;
    case "gte": return compare(v, f.value) >= 0;
    case "lt": return compare(v, f.value) < 0;
    case "lte": return compare(v, f.value) <= 0;
    case "in": return Array.isArray(f.value) && f.value.includes(v);
    case "is": return v === f.value || (f.value === null && v === undefined);
    case "not": {
      // `value` lleva el filtro negado: { op, value }.
      const inner = f.value as { op: FilterOp; value: unknown };
      return !matches(row, { op: inner.op, column: f.column, value: inner.value });
    }
    case "or":
      return evalOr(row, parseOrFilter(String(f.value)));
    case "ilike":
    case "like": {
      const pattern = String(f.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`, f.op === "ilike" ? "i" : "").test(String(v ?? ""));
    }
  }
}

/** `.or()` de PostgREST (mismo subconjunto que el motor D1). */
function evalOr(row: Row, node: OrNode): boolean {
  if (node.kind === "cond") {
    const v = row[node.column];
    switch (node.op) {
      case "eq": return String(v) === node.value;
      case "neq": return String(v) !== node.value;
      case "gt": return compare(v, node.value) > 0;
      case "gte": return compare(v, node.value) >= 0;
      case "lt": return compare(v, node.value) < 0;
      case "lte": return compare(v, node.value) <= 0;
      case "is": return v === null || v === undefined;
    }
  }
  return node.kind === "and" ? node.items.every((n) => evalOr(row, n)) : node.items.some((n) => evalOr(row, n));
}

function project(row: Row, columns: string): Row {
  const cols = columns.trim();
  if (cols === "" || cols === "*") return { ...row };
  const out: Row = {};
  for (const raw of cols.split(",")) {
    const col = raw.trim();
    if (col in row) out[col] = row[col];
  }
  return out;
}

function fail(message: string, code = "DEMO"): QueryResult {
  return { data: null, error: { message, code }, count: null };
}

function finalize(plan: QueryPlan, rows: Row[], count: number | null): QueryResult {
  if (plan.head) return { data: null, error: null, count };
  const projected = rows.map((r) => project(r, plan.columns));
  if (plan.single === "none") return { data: projected, error: null, count };
  if (projected.length === 1) return { data: projected[0], error: null, count };
  if (projected.length === 0 && plan.single === "maybe") return { data: null, error: null, count };
  return fail("JSON object requested, multiple (or no) rows returned", "PGRST116");
}

export function executePlan(plan: QueryPlan, store: Tables): QueryResult {
  if (!KNOWN_TABLES.includes(plan.table)) return fail(`Tabla desconocida: ${plan.table}`, "42P01");
  const table = store[plan.table];
  const keyed = KEY_TABLES.includes(plan.table);
  const pk = keyed ? "key" : "id";

  const filtered = () => table.filter((row) => plan.filters.every((f) => matches(row, f)));

  if (plan.action === "select") {
    const rows = filtered();
    const total = rows.length;
    for (const o of [...plan.order].reverse()) {
      rows.sort((a, b) => (o.ascending ? 1 : -1) * compare(a[o.column], b[o.column]));
    }
    const start = plan.offset ?? 0;
    const limited = plan.limit === null ? rows.slice(start) : rows.slice(start, start + plan.limit);
    return finalize(plan, structuredClone(limited), plan.count ? total : null);
  }

  if (plan.action === "insert" || plan.action === "upsert") {
    const incoming = (Array.isArray(plan.payload) ? plan.payload : [plan.payload]) as Row[];
    const written: Row[] = [];
    for (const raw of incoming) {
      // onConflict puede ser compuesto ("a,b,c"), como en Postgres.
      const conflictKeys = (plan.action === "upsert" ? plan.onConflict || pk : pk).split(",").map((k) => k.trim());
      const existing =
        plan.action === "upsert" && conflictKeys.every((k) => raw[k] !== undefined)
          ? table.find((r) => conflictKeys.every((k) => r[k] === raw[k]))
          : undefined;
      if (existing) {
        Object.assign(existing, raw, { updated_at: nowIso() });
        written.push(existing);
        continue;
      }
      const stamp = nowIso();
      const row: Row = {
        ...(keyed ? {} : { id: crypto.randomUUID() }),
        ...DEFAULTS[plan.table](),
        ...raw,
        created_at: raw.created_at ?? stamp,
        ...(APPEND_ONLY.includes(plan.table) ? {} : { updated_at: stamp }),
      };
      table.push(row);
      written.push(row);
    }
    return finalize(plan, plan.returning ? structuredClone(written) : [], null);
  }

  if (plan.action === "update") {
    const rows = filtered();
    for (const row of rows) Object.assign(row, plan.payload as Row, { updated_at: nowIso() });
    return finalize(plan, plan.returning ? structuredClone(rows) : [], null);
  }

  // delete
  const doomed = new Set(filtered());
  const removed = table.filter((r) => doomed.has(r));
  store[plan.table] = table.filter((r) => !doomed.has(r));
  return finalize(plan, plan.returning ? structuredClone(removed) : [], null);
}
