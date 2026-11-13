/**
 * Contrato mínimo de base SQL que usa la capa de datos. Es un subconjunto
 * exacto de `D1Database` de Cloudflare: en producción se pasa el binding D1,
 * en tests un adaptador sobre node:sqlite (tests/helpers/sqlite-d1.ts).
 *
 * Regla de seguridad: todo valor entra por `bind(...)`. Nunca se interpola
 * un valor en el texto SQL (ver tests/data-guard.test.ts).
 */
export type SqlValue = string | number | null;

export interface SqlRunResult {
  meta: { changes: number };
}

export interface SqlStatement {
  bind(...values: SqlValue[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<SqlRunResult>;
}

export interface SqlDatabase {
  prepare(sql: string): SqlStatement;
  /** Atómico: si una sentencia falla, ninguna queda aplicada. */
  batch(statements: SqlStatement[]): Promise<SqlRunResult[]>;
}

export function nowIso(): string {
  return new Date().toISOString();
}
