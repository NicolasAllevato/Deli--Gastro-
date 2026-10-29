import "./alias.ts";

// Base falsa en memoria sobre el mismo motor del modo demo (`executePlan`): ejercita la lógica de
// negocio real (orders-create, orders-server, zones-server) sin Supabase.
// No se reutiliza `createFakeClient` porque usa "parameter properties" de TypeScript, que el modo
// strip-only de `node --test` no soporta; este constructor de consultas replica su misma interfaz.
const { executePlan } = await import("../../src/lib/demo/query.ts");
const { buildSeed } = await import("../../src/lib/demo/seed.ts");

import type { Filter, FilterOp, QueryPlan, QueryResult } from "../../src/lib/demo/query.ts";
import type { Tables as SeedTables, TableName } from "../../src/lib/demo/seed.ts";
import type { createAdminClient } from "../../src/utils/supabase/admin.ts";

export type Tables = SeedTables;
export type TestDb = ReturnType<typeof createAdminClient>;

class Builder implements PromiseLike<QueryResult> {
  private readonly plan: QueryPlan;
  private readonly store: () => Tables;

  constructor(store: () => Tables, table: TableName) {
    this.store = store;
    this.plan = {
      table, action: "select", columns: "*", filters: [], order: [], limit: null, payload: null,
      onConflict: "", returning: false, count: false, head: false, single: "none",
    };
  }

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }): this {
    if (this.plan.action !== "select") this.plan.returning = true;
    this.plan.columns = columns;
    this.plan.count = Boolean(opts?.count);
    this.plan.head = Boolean(opts?.head);
    return this;
  }
  insert(payload: unknown): this { this.plan.action = "insert"; this.plan.payload = payload; return this; }
  update(payload: unknown): this { this.plan.action = "update"; this.plan.payload = payload; return this; }
  upsert(payload: unknown, opts?: { onConflict?: string }): this {
    this.plan.action = "upsert"; this.plan.payload = payload; this.plan.onConflict = opts?.onConflict ?? "";
    return this;
  }
  delete(): this { this.plan.action = "delete"; return this; }

  private filter(op: FilterOp, column: string, value: unknown): this {
    const f: Filter = { op, column, value };
    this.plan.filters.push(f);
    return this;
  }
  eq(c: string, v: unknown): this { return this.filter("eq", c, v); }
  neq(c: string, v: unknown): this { return this.filter("neq", c, v); }
  gt(c: string, v: unknown): this { return this.filter("gt", c, v); }
  gte(c: string, v: unknown): this { return this.filter("gte", c, v); }
  lt(c: string, v: unknown): this { return this.filter("lt", c, v); }
  lte(c: string, v: unknown): this { return this.filter("lte", c, v); }
  in(c: string, v: unknown[]): this { return this.filter("in", c, v); }
  is(c: string, v: unknown): this { return this.filter("is", c, v); }
  ilike(c: string, p: string): this { return this.filter("ilike", c, p); }
  like(c: string, p: string): this { return this.filter("like", c, p); }
  not(c: string, op: FilterOp, v: unknown): this { return this.filter("not", c, { op, value: v }); }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.plan.order.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }
  limit(n: number): this { this.plan.limit = n; return this; }
  single(): this { this.plan.single = "single"; return this; }
  maybeSingle(): this { this.plan.single = "maybe"; return this; }

  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(executePlan(this.plan, this.store())).then(onfulfilled, onrejected);
  }
}

export interface DemoDb {
  /** Cliente con la forma de supabase-js, para pasarle a las funciones de `src/lib`. */
  db: TestDb;
  /** Estado en memoria, para armar escenarios y verificar resultados. */
  store: Tables;
}

export function createDemoDb(mutate?: (store: Tables) => void): DemoDb {
  const holder = { store: buildSeed() };
  mutate?.(holder.store);
  // `executePlan` puede reemplazar el arreglo de una tabla (delete): se lee siempre del holder.
  const db = { from: (table: TableName) => new Builder(() => holder.store, table) } as unknown as TestDb;
  return {
    db,
    get store() {
      return holder.store;
    },
  };
}

/** Pone un valor en `global_config` (crea la fila si no existe). */
export function setConfig(store: Tables, key: string, value: unknown): void {
  const row = store.global_config.find((r) => r.key === key);
  if (row) row.value = value;
  else store.global_config.push({ key, value });
}
