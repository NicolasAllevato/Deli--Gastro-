import type { Row, TableName, Tables } from "@/lib/demo/seed";

/**
 * Motor de consultas mínimo, compatible con el subconjunto de la API de
 * supabase-js que usa esta app (select/insert/update/upsert/delete + filtros).
 * Un `QueryPlan` es serializable: el navegador lo envía a /api/demo/query y el
 * servidor lo ejecuta contra el store.
 */

export type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "ilike";

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
  "clients", "orders", "points_ledger", "global_config", "categories", "products", "reviews",
];

function nowIso(): string {
  return new Date().toISOString();
}

const DEFAULTS: Record<TableName, () => Row> = {
  clients: () => ({ user_id: null, phone: null, address: null, tier: "Bronce", total_points: 0 }),
  orders: () => ({
    client_id: null, status: "Recibidos", delivery_fee: 0, delivery_address: null,
    delivery_lat: null, delivery_lng: null, payment_method: null, notes: null, courier_name: null,
  }),
  points_ledger: () => ({ order_id: null }),
  global_config: () => ({}),
  categories: () => ({ description: "", is_active: true }),
  products: () => ({ category_id: null, description: "", image_url: "", is_active: true }),
  reviews: () => ({ feedback: null }),
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
    case "ilike": {
      const pattern = String(f.value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*");
      return new RegExp(`^${pattern}$`, "i").test(String(v ?? ""));
    }
  }
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
  const pk = plan.table === "global_config" ? "key" : "id";

  const filtered = () => table.filter((row) => plan.filters.every((f) => matches(row, f)));

  if (plan.action === "select") {
    const rows = filtered();
    const total = rows.length;
    for (const o of [...plan.order].reverse()) {
      rows.sort((a, b) => (o.ascending ? 1 : -1) * compare(a[o.column], b[o.column]));
    }
    const limited = plan.limit === null ? rows : rows.slice(0, plan.limit);
    return finalize(plan, structuredClone(limited), plan.count ? total : null);
  }

  if (plan.action === "insert" || plan.action === "upsert") {
    const incoming = (Array.isArray(plan.payload) ? plan.payload : [plan.payload]) as Row[];
    const written: Row[] = [];
    for (const raw of incoming) {
      const conflictKey = plan.action === "upsert" ? plan.onConflict || pk : pk;
      const existing =
        plan.action === "upsert" && raw[conflictKey] !== undefined
          ? table.find((r) => r[conflictKey] === raw[conflictKey])
          : undefined;
      if (existing) {
        Object.assign(existing, raw, { updated_at: nowIso() });
        written.push(existing);
        continue;
      }
      const stamp = nowIso();
      const row: Row = {
        ...(plan.table === "global_config" ? {} : { id: crypto.randomUUID() }),
        ...DEFAULTS[plan.table](),
        ...raw,
        created_at: raw.created_at ?? stamp,
        ...(plan.table === "points_ledger" || plan.table === "reviews" ? {} : { updated_at: stamp }),
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
