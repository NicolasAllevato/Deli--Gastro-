/**
 * Etapa 1 del corte: motor que ejecuta en D1 los "planes" del cliente compatible con supabase-js
 * (el mismo QueryPlan del modo demo). Con DATA_BACKEND=d1, createAdminClient() usa este motor y las
 * rutas dejan de tocar Supabase sin reescribir cada una.
 *
 * Seguridad:
 * - Equivale al service-role de hoy: la autorización sigue en cada ruta (requireRole/requireClient),
 *   como ya pasaba con Supabase. Solo se ejecuta como actor de sistema/staff.
 * - Tablas y columnas por lista blanca: tabla de APP_TABLES y columnas reales de D1 (PRAGMA
 *   table_info); identificadores entre comillas dobles. Todos los valores van con bind().
 * - integration_secrets no existe en D1 (D5): leer devuelve vacío (el entorno manda) y escribir falla.
 * - Montos: la app sigue hablando en pesos; en D1 son centavos (*_cents). Booleanos 0/1 ↔ true/false
 *   y JSON texto ↔ objeto se convierten acá.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { fromCents, toCents } from "./money.ts";
import { orColumns, parseOrFilter, type OrNode } from "../or-filter.ts";
import type { SqlDatabase, SqlValue } from "./sql.ts";

export type PlanFilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "ilike" | "like" | "not" | "or";

export interface PlanFilter {
  op: PlanFilterOp;
  column: string;
  value: unknown;
}

/** Mismo contrato que QueryPlan de src/lib/demo/query.ts (más el filtro `or`). */
export interface Plan {
  table: string;
  action: "select" | "insert" | "update" | "upsert" | "delete";
  columns: string;
  filters: PlanFilter[];
  order: Array<{ column: string; ascending: boolean }>;
  limit: number | null;
  offset?: number;
  payload: unknown;
  onConflict: string;
  /** upsert: dejar intacta la fila existente (ON CONFLICT DO NOTHING), como supabase-js. */
  ignoreDuplicates?: boolean;
  returning: boolean;
  count: boolean;
  head: boolean;
  single: "none" | "single" | "maybe";
}

export interface PlanResult {
  data: unknown;
  error: { message: string; code: string } | null;
  count: number | null;
}

type Row = Record<string, unknown>;

/** Tablas de la app en D1 (nunca las de recetas ni las de Better Auth). */
export const APP_TABLES = new Set([
  "categories", "products", "clients", "points_ledger", "orders", "order_items", "order_events", "reviews",
  "payment_intents", "delivery_zones", "reports_daily", "couriers", "courier_locations", "courier_shifts",
  "global_config", "legal_acceptances", "fudo_product_map", "fudo_payment_map", "fudo_sync_runs",
  "wa_conversations", "wa_messages", "wa_campaigns",
]);

const PK: Record<string, string> = {
  global_config: "key", fudo_payment_map: "payment_method", fudo_product_map: "product_id",
  couriers: "user_id", courier_locations: "user_id",
};

/** Pesos (nombre de la app) → centavos (nombre en D1), por tabla. */
const MONEY: Record<string, Record<string, string>> = {
  orders: { total: "total_cents", delivery_fee: "delivery_fee_cents" },
  order_items: { unit_price: "unit_price_cents" },
  products: { price: "price_cents" },
  payment_intents: { total: "total_cents" },
  delivery_zones: { fee: "fee_cents", min_order: "min_order_cents" },
  reports_daily: { total_income: "total_income_cents" },
};

const BOOL = new Set(["active", "delivered_in_app", "human_takeover", "is_active", "is_anonymous", "is_combo", "ok", "show_in_portal", "wa_marketing_opt_in"]);
const JSON_COLS: Record<string, Set<string>> = {
  orders: new Set(["fudo_payments"]), order_items: new Set(["fudo_options"]), payment_intents: new Set(["snapshot"]),
  delivery_zones: new Set(["shape"]), wa_conversations: new Set(["state"]), wa_campaigns: new Set(["segment"]),
  global_config: new Set(["value"]),
};

const ident = (name: string) => `"${name.replace(/"/g, '""')}"`;
/** D1 acepta como máximo 100 parámetros ligados por sentencia: in() y embebidos se limitan/parten. */
const MAX_IN = 90;
const fail = (message: string, code: string): PlanResult => ({ data: null, error: { message, code }, count: null });

/** Columnas reales de cada tabla (cacheadas por base). */
const columnCache = new WeakMap<SqlDatabase, Map<string, Set<string>>>();
async function columnsOf(db: SqlDatabase, table: string): Promise<Set<string>> {
  let cache = columnCache.get(db);
  if (!cache) columnCache.set(db, (cache = new Map()));
  const hit = cache.get(table);
  if (hit) return hit;
  // table ya pasó por APP_TABLES: el identificador es de la lista blanca.
  const { results } = await db.prepare(`PRAGMA table_info(${ident(table)})`).all<{ name: string }>();
  const cols = new Set(results.map((r) => r.name));
  cache.set(table, cols);
  return cols;
}

/** Nombre de la app → columna D1 (validada). */
function d1Column(table: string, cols: Set<string>, appName: string): string {
  const name = MONEY[table]?.[appName] ?? appName;
  if (!cols.has(name)) throw new PlanError(`columna desconocida ${table}.${appName}`, "42703");
  return name;
}

class PlanError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

function toD1Value(table: string, appName: string, v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (MONEY[table]?.[appName]) return toCents(v as number | string);
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

/** Fila de D1 → forma de la app (pesos, booleanos, JSON). */
export function fromD1Row(table: string, row: Row): Row {
  const money = MONEY[table] ?? {};
  const reverse = Object.fromEntries(Object.entries(money).map(([app, d1]) => [d1, app]));
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    if (reverse[k]) out[reverse[k]] = v === null ? null : fromCents(Number(v));
    else if (BOOL.has(k)) out[k] = v === null ? null : Boolean(v);
    else if (JSON_COLS[table]?.has(k) && typeof v === "string") out[k] = JSON.parse(v);
    else out[k] = v;
  }
  return out;
}

interface Where {
  sql: string;
  params: SqlValue[];
}

function orToSql(table: string, cols: Set<string>, node: OrNode): Where {
  if (node.kind === "cond") {
    const col = ident(d1Column(table, cols, node.column));
    if (node.op === "is") return { sql: `${col} IS NULL`, params: [] };
    const sym = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" }[node.op];
    return { sql: `${col} ${sym} ?`, params: [toD1Value(table, node.column, node.value)] };
  }
  const parts = node.items.map((n) => orToSql(table, cols, n));
  return { sql: `(${parts.map((p) => p.sql).join(node.kind === "and" ? " AND " : " OR ")})`, params: parts.flatMap((p) => p.params) };
}

function filterToSql(table: string, cols: Set<string>, f: PlanFilter): Where {
  if (f.op === "or") {
    const node = parseOrFilter(String(f.value));
    for (const c of orColumns(node)) d1Column(table, cols, c);
    return orToSql(table, cols, node);
  }
  const col = ident(d1Column(table, cols, f.column));
  const val = (v: unknown) => toD1Value(table, f.column, v);
  switch (f.op) {
    case "eq": return { sql: `${col} = ?`, params: [val(f.value)] };
    // Igual que Postgres/PostgREST: `col <> x` excluye las filas con NULL.
    case "neq": return { sql: `${col} <> ?`, params: [val(f.value)] };
    case "gt": return { sql: `${col} > ?`, params: [val(f.value)] };
    case "gte": return { sql: `${col} >= ?`, params: [val(f.value)] };
    case "lt": return { sql: `${col} < ?`, params: [val(f.value)] };
    case "lte": return { sql: `${col} <= ?`, params: [val(f.value)] };
    case "in": {
      const list = Array.isArray(f.value) ? f.value : [];
      if (list.length > MAX_IN) throw new PlanError(`in() con más de ${MAX_IN} valores`, "54000");
      if (list.length === 0) return { sql: "0", params: [] };
      return { sql: `${col} IN (${list.map(() => "?").join(", ")})`, params: list.map(val) };
    }
    case "is":
      if (f.value === null) return { sql: `${col} IS NULL`, params: [] };
      return { sql: `${col} = ?`, params: [val(f.value)] };
    case "like": return { sql: `${col} LIKE ?`, params: [String(f.value)] };
    case "ilike": return { sql: `lower(${col}) LIKE lower(?)`, params: [String(f.value)] };
    case "not": {
      const inner = f.value as { op: PlanFilterOp; value: unknown };
      const w = filterToSql(table, cols, { op: inner.op, column: f.column, value: inner.value });
      return { sql: `NOT (${w.sql})`, params: w.params };
    }
  }
}

function whereOf(table: string, cols: Set<string>, filters: PlanFilter[]): Where {
  const parts = filters.map((f) => filterToSql(table, cols, f));
  return parts.length === 0
    ? { sql: "", params: [] }
    : { sql: ` WHERE ${parts.map((p) => p.sql).join(" AND ")}`, params: parts.flatMap((p) => p.params) };
}

interface Embed {
  table: string;
  columns: string;
}

/** "a, b, rel(x, y)" → columnas simples + embebidos. */
function parseColumns(spec: string): { plain: string[]; embeds: Embed[] } {
  const plain: string[] = [];
  const embeds: Embed[] = [];
  let depth = 0;
  let cur = "";
  const flush = () => {
    const item = cur.trim();
    cur = "";
    if (!item) return;
    const m = /^([a-z_]+)(?:!inner)?\(([\s\S]*)\)$/.exec(item);
    if (m) embeds.push({ table: m[1], columns: m[2] });
    else plain.push(item);
  };
  for (const ch of spec) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) flush();
    else cur += ch;
  }
  flush();
  return { plain, embeds };
}

const singular = (t: string) => (t.endsWith("ies") ? `${t.slice(0, -3)}y` : t.replace(/s$/, ""));

function project(row: Row, plain: string[]): Row {
  if (plain.length === 0 || plain.includes("*")) return row;
  return Object.fromEntries(plain.filter((c) => c in row).map((c) => [c, row[c]]));
}

/** SELECT … WHERE col IN (…) en lotes de MAX_IN (tope de parámetros de D1). `col` ya validada contra el esquema. */
async function selectIn(db: SqlDatabase, table: string, col: string, ids: SqlValue[]): Promise<Row[]> {
  const out: Row[] = [];
  for (let i = 0; i < ids.length; i += MAX_IN) {
    const batch = ids.slice(i, i + MAX_IN);
    const { results } = await db.prepare(`SELECT * FROM ${ident(table)} WHERE ${ident(col)} IN (${batch.map(() => "?").join(", ")})`).bind(...batch).all<Row>();
    out.push(...results);
  }
  return out;
}

async function attachEmbeds(db: SqlDatabase, table: string, rows: Row[], embeds: Embed[]): Promise<void> {
  for (const e of embeds) {
    if (!APP_TABLES.has(e.table)) throw new PlanError(`tabla desconocida ${e.table}`, "42P01");
    const relCols = await columnsOf(db, e.table);
    const mainCols = await columnsOf(db, table);
    const childFk = `${singular(table)}_id`;
    const parentFk = `${singular(e.table)}_id`;
    const { plain } = parseColumns(e.columns);
    if (relCols.has(childFk)) {
      // Hijos: order_items(*) desde orders → arreglo.
      const ids = rows.map((r) => r[PK[table] ?? "id"]).filter((v) => v !== null && v !== undefined) as SqlValue[];
      const children = await selectIn(db, e.table, childFk, ids);
      for (const r of rows) {
        r[e.table] = children.filter((c) => c[childFk] === r[PK[table] ?? "id"]).map((c) => project(fromD1Row(e.table, c), plain));
      }
    } else if (mainCols.has(parentFk)) {
      // Padre: categories(name) desde products → objeto o null.
      const ids = [...new Set(rows.map((r) => r[parentFk]).filter((v) => v !== null && v !== undefined))] as SqlValue[];
      const parents = await selectIn(db, e.table, PK[e.table] ?? "id", ids);
      for (const r of rows) {
        const p = parents.find((x) => x[PK[e.table] ?? "id"] === r[parentFk]);
        r[e.table] = p ? project(fromD1Row(e.table, p), plain) : null;
      }
    } else {
      throw new PlanError(`relación no soportada ${table} → ${e.table}`, "PGRST200");
    }
  }
}

async function shape(db: SqlDatabase, plan: Plan, raw: Row[], count: number | null): Promise<PlanResult> {
  if (plan.head) return { data: null, error: null, count };
  const { plain, embeds } = parseColumns(plan.columns || "*");
  const rows = raw.map((r) => fromD1Row(plan.table, r));
  await attachEmbeds(db, plan.table, rows, embeds);
  const out = rows.map((r) => project(r, [...plain, ...embeds.map((e) => e.table)]));
  if (plan.single === "none") return { data: out, error: null, count };
  if (out.length === 1) return { data: out[0], error: null, count };
  if (out.length === 0 && plan.single === "maybe") return { data: null, error: null, count };
  return fail("JSON object requested, multiple (or no) rows returned", "PGRST116");
}

function errorCode(err: unknown): PlanResult {
  if (err instanceof PlanError) return fail(err.message, err.code);
  const msg = err instanceof Error ? err.message : String(err);
  if (/UNIQUE constraint failed/i.test(msg)) return fail("duplicate key value violates unique constraint", "23505");
  if (/FOREIGN KEY constraint failed/i.test(msg)) return fail("violates foreign key constraint", "23503");
  if (/CHECK constraint failed/i.test(msg)) return fail("violates check constraint", "23514");
  if (/NOT NULL constraint failed/i.test(msg)) return fail("null value violates not-null constraint", "23502");
  return fail("error de base de datos", "D1");
}

function rowValues(table: string, cols: Set<string>, raw: Row): { names: string[]; values: SqlValue[] } {
  const names: string[] = [];
  const values: SqlValue[] = [];
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    names.push(d1Column(table, cols, k));
    values.push(toD1Value(table, k, v));
  }
  return { names, values };
}

const NOW = () => new Date().toISOString();
const SQL_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

/** Ejecuta un plan en D1. Solo staff/sistema (equivalente al service-role). */
export async function executeD1Plan(db: SqlDatabase, actor: Actor, plan: Plan): Promise<PlanResult> {
  requireStaff(actor);
  if (plan.table === "integration_secrets") {
    // D5: los secretos viven en Worker secrets; el código ya prioriza las variables de entorno.
    return plan.action === "select" ? { data: plan.single === "none" ? [] : null, error: null, count: 0 } : fail("los secretos van a Worker secrets, no a D1", "D5");
  }
  if (!APP_TABLES.has(plan.table)) return fail(`tabla desconocida ${plan.table}`, "42P01");
  const t = ident(plan.table);
  try {
    const cols = await columnsOf(db, plan.table);
    const pk = PK[plan.table] ?? "id";

    if (plan.action === "select") {
      const where = whereOf(plan.table, cols, plan.filters);
      const count = plan.count
        ? Number((await db.prepare(`SELECT count(*) AS n FROM ${t}${where.sql}`).bind(...where.params).first<{ n: number }>())?.n ?? 0)
        : null;
      if (plan.head) return { data: null, error: null, count };
      const order = plan.order.map((o) => `${ident(d1Column(plan.table, cols, o.column))} ${o.ascending ? "ASC" : "DESC"}`);
      const paging: SqlValue[] = [];
      let tail = order.length ? ` ORDER BY ${order.join(", ")}` : "";
      if (plan.limit !== null || plan.offset) {
        tail += " LIMIT ? OFFSET ?";
        paging.push(plan.limit ?? -1, plan.offset ?? 0);
      }
      const { results } = await db.prepare(`SELECT * FROM ${t}${where.sql}${tail}`).bind(...where.params, ...paging).all<Row>();
      return shape(db, plan, results, count);
    }

    if (plan.action === "insert" || plan.action === "upsert") {
      const incoming = (Array.isArray(plan.payload) ? plan.payload : [plan.payload]) as Row[];
      const conflict = (plan.action === "upsert" ? plan.onConflict || pk : "").split(",").map((k) => k.trim()).filter(Boolean)
        .map((k) => d1Column(plan.table, cols, k));
      const written: Row[] = [];
      for (const raw of incoming) {
        const row = { ...raw };
        const generatedId = pk === "id" && cols.has("id") && row.id === undefined;
        if (generatedId) row.id = crypto.randomUUID();
        const { names, values } = rowValues(plan.table, cols, row);
        let sql = `INSERT INTO ${t} (${names.map(ident).join(", ")}) VALUES (${names.map(() => "?").join(", ")})`;
        if (conflict.length) {
          // Un id generado acá nunca pisa el de la fila existente (si no, cambia la clave que ya tienen otros).
          const sets = plan.ignoreDuplicates ? [] : names.filter((n) => !conflict.includes(n) && !(generatedId && n === "id")).map((n) => `${ident(n)} = excluded.${ident(n)}`);
          // Sin interpolar valores: la fecha la pone SQLite.
          if (!plan.ignoreDuplicates && cols.has("updated_at") && !names.includes("updated_at")) sets.push(`"updated_at" = ${SQL_NOW}`);
          sql += ` ON CONFLICT (${conflict.map(ident).join(", ")}) ${sets.length ? `DO UPDATE SET ${sets.join(", ")}` : "DO NOTHING"}`;
        }
        const back = await db.prepare(`${sql} RETURNING *`).bind(...values).all<Row>();
        written.push(...back.results);
      }
      return shape(db, plan, plan.returning ? written : [], null);
    }

    const where = whereOf(plan.table, cols, plan.filters);
    // Como PostgREST (pg_safeupdate): nunca UPDATE ni DELETE sobre toda la tabla por un filtro que faltó.
    if (!where.sql) return fail(`${plan.action === "update" ? "UPDATE" : "DELETE"} requires a WHERE clause`, "21000");
    if (plan.action === "update") {
      const { names, values } = rowValues(plan.table, cols, (plan.payload ?? {}) as Row);
      if (cols.has("updated_at") && !names.includes("updated_at")) {
        names.push("updated_at");
        values.push(NOW());
      }
      if (names.length === 0) return shape(db, plan, [], null);
      const { results } = await db
        .prepare(`UPDATE ${t} SET ${names.map((n) => `${ident(n)} = ?`).join(", ")}${where.sql} RETURNING *`)
        .bind(...values, ...where.params)
        .all<Row>();
      return shape(db, plan, plan.returning ? results : [], null);
    }

    // delete
    const { results } = await db.prepare(`DELETE FROM ${t}${where.sql} RETURNING *`).bind(...where.params).all<Row>();
    return shape(db, plan, plan.returning ? results : [], null);
  } catch (err) {
    return errorCode(err);
  }
}
