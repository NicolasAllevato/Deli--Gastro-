/**
 * Etapa 2 del corte: con DATA_BACKEND=d1 el gateway escribe directo en D1. rest() sigue recibiendo
 * paths de PostgREST (`orders?id=eq.x&select=…`); acá se traducen al plan del motor de la app
 * (src/lib/data/plan-sql.ts), que valida tablas y columnas y liga todos los valores.
 * Subconjunto soportado (el que usa el gateway): select, order, limit, on_conflict, filtros
 * eq/neq/gt/gte/lt/lte/like/ilike/in.(…)/is.(null|true|false) y su negación not.<op>.
 */
import { executeD1Plan, type Plan, type PlanFilter, type PlanFilterOp } from "../../../src/lib/data/plan-sql.ts";
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";

const SYSTEM = { kind: "system", reason: "fudo-gateway" } as const;
const OPS = new Set(["eq", "neq", "gt", "gte", "lt", "lte", "like", "ilike", "in", "is"]);
const RESERVED = new Set(["select", "order", "limit", "offset", "on_conflict"]);

/** "a","b",c → ["a", "b", "c"] (valores de in.(…), con comillas dobles opcionales). */
function parseList(raw: string): string[] {
  const inner = raw.replace(/^\(/, "").replace(/\)$/, "");
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (const ch of inner) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (inner.length) out.push(cur);
  return out;
}

function scalar(raw: string): unknown {
  if (raw === "null") return null;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return raw;
}

function parseFilter(column: string, expr: string): PlanFilter {
  let negate = false;
  let rest = expr;
  if (rest.startsWith("not.")) {
    negate = true;
    rest = rest.slice(4);
  }
  const dot = rest.indexOf(".");
  const op = rest.slice(0, dot);
  const raw = rest.slice(dot + 1);
  if (dot < 0 || !OPS.has(op)) throw new Error(`filtro no soportado: ${column}`);
  const value = op === "in" ? parseList(raw) : scalar(raw);
  const base: PlanFilter = { op: op as PlanFilterOp, column, value };
  return negate ? { op: "not", column, value: { op: base.op, value: base.value } } : base;
}

export function postgrestToPlan(path: string, init: RequestInit = {}): Plan {
  const q = path.indexOf("?");
  const table = q < 0 ? path : path.slice(0, q);
  const params = new URLSearchParams(q < 0 ? "" : path.slice(q + 1));
  const method = (init.method ?? "GET").toUpperCase();
  const prefer = new Headers(init.headers).get("prefer") ?? "";
  const filters: PlanFilter[] = [];
  for (const [key, value] of params) if (!RESERVED.has(key)) filters.push(parseFilter(key, value));
  const order = (params.get("order") ?? "").split(",").filter(Boolean).map((o) => {
    const [column, dir] = o.split(".");
    return { column, ascending: dir !== "desc" };
  });
  const limit = params.get("limit");
  const action: Plan["action"] =
    method === "GET" ? "select" : method === "PATCH" ? "update" : method === "DELETE" ? "delete"
      : /resolution=merge-duplicates/.test(prefer) || params.has("on_conflict") ? "upsert" : "insert";
  return {
    table,
    action,
    columns: params.get("select") ?? "*",
    filters,
    order,
    limit: limit ? Number(limit) : null,
    payload: init.body ? JSON.parse(String(init.body)) : null,
    onConflict: params.get("on_conflict") ?? "",
    returning: method !== "GET",
    count: false,
    head: false,
    single: "none",
  };
}

/** rest() contra D1: misma respuesta que PostgREST (filas) o el mismo tipo de error. */
export async function restD1<T>(db: SqlDatabase, path: string, init: RequestInit = {}): Promise<T> {
  const result = await executeD1Plan(db, SYSTEM, postgrestToPlan(path, init));
  if (result.error) throw new Error(`D1 ${path.split("?")[0]} ${result.error.code}: ${result.error.message}`);
  const wantsBody = !/return=minimal/.test(new Headers(init.headers).get("prefer") ?? "");
  return ((init.method ?? "GET").toUpperCase() === "GET" || wantsBody ? result.data : undefined) as T;
}
