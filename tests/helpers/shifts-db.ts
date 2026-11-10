import type { createAdminClient } from "../../src/utils/supabase/admin.ts";

// Base falsa mínima para `courier_shifts`: imita solo lo que usa `src/lib/courier-shifts.ts`
// (`from().select/update/upsert().eq().order().maybeSingle()`), sin red ni Supabase.
// Evita "parameter properties" porque `node --test` corre en modo strip-only.

export type ShiftsTestDb = ReturnType<typeof createAdminClient>;
export type ShiftRowData = Record<string, unknown>;

type Action = "select" | "update" | "upsert";
interface Result {
  data: unknown;
  error: { message: string } | null;
}

export interface FakeShiftsDb {
  /** Cliente con la forma de supabase-js, para pasarle a las funciones de `src/lib/courier-shifts.ts`. */
  db: ShiftsTestDb;
  /** Filas de la tabla en memoria, para armar escenarios y verificar resultados. */
  rows: ShiftRowData[];
}

interface FakeOptions {
  /** Si se indica, toda consulta responde con este error. */
  failWith?: string;
}

function project(row: ShiftRowData, columns: string): ShiftRowData {
  if (columns === "*") return { ...row };
  const picked: ShiftRowData = {};
  for (const name of columns.split(",").map((c) => c.trim())) picked[name] = row[name];
  return picked;
}

class Query implements PromiseLike<Result> {
  private readonly rows: ShiftRowData[];
  private readonly failWith: string | undefined;
  private action: Action = "select";
  private payload: ShiftRowData = {};
  private columns = "*";
  private returning = false;
  private ignoreDuplicates = false;
  private conflictColumns: string[] = [];
  private single = false;
  private readonly filters: Array<[string, unknown]> = [];
  private sortBy: { column: string; ascending: boolean } | null = null;

  constructor(rows: ShiftRowData[], failWith: string | undefined) {
    this.rows = rows;
    this.failWith = failWith;
  }

  select(columns = "*"): this {
    if (this.action !== "select") this.returning = true;
    this.columns = columns;
    return this;
  }
  update(payload: ShiftRowData): this {
    this.action = "update";
    this.payload = payload;
    return this;
  }
  upsert(payload: ShiftRowData, opts?: { onConflict?: string; ignoreDuplicates?: boolean }): this {
    this.action = "upsert";
    this.payload = payload;
    this.conflictColumns = (opts?.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    this.ignoreDuplicates = Boolean(opts?.ignoreDuplicates);
    return this;
  }
  eq(column: string, value: unknown): this {
    this.filters.push([column, value]);
    return this;
  }
  order(column: string, opts?: { ascending?: boolean }): this {
    this.sortBy = { column, ascending: opts?.ascending ?? true };
    return this;
  }
  maybeSingle(): this {
    this.single = true;
    return this;
  }

  private matching(): ShiftRowData[] {
    return this.rows.filter((row) => this.filters.every(([column, value]) => row[column] === value));
  }

  private shape(found: ShiftRowData[]): Result {
    const sorted = this.sortBy
      ? [...found].sort((a, b) => {
          const { column, ascending } = this.sortBy as { column: string; ascending: boolean };
          const [x, y] = [String(a[column]), String(b[column])];
          return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1);
        })
      : found;
    const projected = sorted.map((row) => project(row, this.columns));
    return { data: this.single ? (projected[0] ?? null) : projected, error: null };
  }

  private upsertRow(): Result {
    const duplicate = this.rows.find((row) => this.conflictColumns.every((c) => row[c] === this.payload[c]));
    if (duplicate && !this.ignoreDuplicates) Object.assign(duplicate, this.payload);
    // Valores por defecto de la tabla (migración 029).
    if (!duplicate) {
      this.rows.push({
        id: `id-${this.rows.length + 1}`,
        status: "pending",
        requested_at: "2026-11-10T12:00:00.000Z",
        decided_at: null,
        ...this.payload,
      });
    }
    return { data: null, error: null };
  }

  private execute(): Result {
    if (this.failWith) return { data: null, error: { message: this.failWith } };
    if (this.action === "upsert") return this.upsertRow();
    const found = this.matching();
    if (this.action === "update") {
      for (const row of found) Object.assign(row, this.payload);
      return this.returning ? this.shape(found) : { data: null, error: null };
    }
    return this.shape(found);
  }

  then<R1 = Result, R2 = never>(
    onfulfilled?: ((value: Result) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): PromiseLike<R1 | R2> {
    return Promise.resolve(this.execute()).then(onfulfilled, onrejected);
  }
}

export function createFakeShiftsDb(seed: ShiftRowData[] = [], options: FakeOptions = {}): FakeShiftsDb {
  const rows = seed.map((row) => ({ ...row }));
  const db = {
    from: (table: string) => {
      if (table !== "courier_shifts") throw new Error(`Tabla inesperada en el test: ${table}`);
      return new Query(rows, options.failWith);
    },
  } as unknown as ShiftsTestDb;
  return { db, rows };
}
