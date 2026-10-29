import type { SupabaseClient, User } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { TableName } from "@/lib/demo/seed";
import type { Filter, FilterOp, QueryPlan, QueryResult } from "@/lib/demo/query";

/**
 * Cliente "falso" con la misma forma que el de supabase-js para el subconjunto
 * que usa la app. La ejecución real la hace un `DemoTransport`:
 *  - servidor: ejecuta el plan contra el store en memoria
 *  - navegador: lo envía a /api/demo/query
 */
export interface DemoTransport {
  execute(plan: QueryPlan): Promise<QueryResult>;
  getUser(): Promise<User | null>;
  signIn(email: string, password: string): Promise<{ error: { message: string } | null }>;
  signOut(): Promise<void>;
}

class DemoQueryBuilder implements PromiseLike<QueryResult> {
  private readonly plan: QueryPlan;

  constructor(private readonly transport: DemoTransport, table: TableName) {
    this.plan = {
      table,
      action: "select",
      columns: "*",
      filters: [],
      order: [],
      limit: null,
      payload: null,
      onConflict: "",
      returning: false,
      count: false,
      head: false,
      single: "none",
    };
  }

  select(columns = "*", opts?: { count?: "exact"; head?: boolean }): this {
    // Tras insert/update/upsert/delete, select() pide las filas afectadas.
    if (this.plan.action !== "select") this.plan.returning = true;
    this.plan.columns = columns;
    this.plan.count = Boolean(opts?.count);
    this.plan.head = Boolean(opts?.head);
    return this;
  }

  insert(payload: unknown): this {
    this.plan.action = "insert";
    this.plan.payload = payload;
    return this;
  }

  update(payload: unknown): this {
    this.plan.action = "update";
    this.plan.payload = payload;
    return this;
  }

  upsert(payload: unknown, opts?: { onConflict?: string }): this {
    this.plan.action = "upsert";
    this.plan.payload = payload;
    this.plan.onConflict = opts?.onConflict ?? "";
    return this;
  }

  delete(): this {
    this.plan.action = "delete";
    return this;
  }

  private filter(op: FilterOp, column: string, value: unknown): this {
    const f: Filter = { op, column, value };
    this.plan.filters.push(f);
    return this;
  }

  eq(column: string, value: unknown): this { return this.filter("eq", column, value); }
  neq(column: string, value: unknown): this { return this.filter("neq", column, value); }
  gt(column: string, value: unknown): this { return this.filter("gt", column, value); }
  gte(column: string, value: unknown): this { return this.filter("gte", column, value); }
  lt(column: string, value: unknown): this { return this.filter("lt", column, value); }
  lte(column: string, value: unknown): this { return this.filter("lte", column, value); }
  in(column: string, values: unknown[]): this { return this.filter("in", column, values); }
  is(column: string, value: unknown): this { return this.filter("is", column, value); }
  ilike(column: string, pattern: string): this { return this.filter("ilike", column, pattern); }
  like(column: string, pattern: string): this { return this.filter("like", column, pattern); }
  not(column: string, operator: FilterOp, value: unknown): this {
    return this.filter("not", column, { op: operator, value });
  }

  order(column: string, opts?: { ascending?: boolean }): this {
    this.plan.order.push({ column, ascending: opts?.ascending ?? true });
    return this;
  }

  limit(n: number): this {
    this.plan.limit = n;
    return this;
  }

  single(): this {
    this.plan.single = "single";
    return this;
  }

  maybeSingle(): this {
    this.plan.single = "maybe";
    return this;
  }

  then<R1 = QueryResult, R2 = never>(
    onfulfilled?: ((value: QueryResult) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return this.transport.execute(this.plan).then(onfulfilled, onrejected);
  }
}

export function createFakeClient(transport: DemoTransport): SupabaseClient<Database> {
  const fake = {
    from: (table: TableName) => new DemoQueryBuilder(transport, table),
    auth: {
      async getUser() {
        const user = await transport.getUser();
        return user
          ? { data: { user }, error: null }
          : { data: { user: null }, error: { message: "Auth session missing!" } };
      },
      async signInWithPassword(creds: { email: string; password: string }) {
        const { error } = await transport.signIn(creds.email, creds.password);
        return { data: { user: null, session: null }, error };
      },
      async signOut() {
        await transport.signOut();
        return { error: null };
      },
    },
  };
  return fake as unknown as SupabaseClient<Database>;
}
