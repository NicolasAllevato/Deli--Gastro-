/**
 * Adaptador node:sqlite → contrato D1 (SqlDatabase) para tests de la capa de
 * datos. Aplica el esquema real d1/schema/0001_inicial.sql.
 */
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import type { SqlDatabase, SqlStatement, SqlValue, SqlRunResult } from "../../src/lib/data/sql.ts";

// Esquema base + migraciones en orden, igual que se aplican en la D1 remota.
const MIGRATIONS = new URL("../../d1/migrations/", import.meta.url);
const SCHEMA = [
  readFileSync(new URL("../../d1/schema/0001_inicial.sql", import.meta.url), "utf8"),
  ...readdirSync(MIGRATIONS)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(new URL(f, MIGRATIONS), "utf8")),
].join("\n");

export function createTestDb(): SqlDatabase & { raw: DatabaseSync } {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);

  const stmt = (sql: string, params: SqlValue[] = []): SqlStatement & { sql: string; params: SqlValue[] } => ({
    sql,
    params,
    bind: (...values: SqlValue[]) => stmt(sql, values),
    first: async <T>() => (raw.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>() => ({ results: raw.prepare(sql).all(...params) as T[] }),
    run: async (): Promise<SqlRunResult> => ({ meta: { changes: Number(raw.prepare(sql).run(...params).changes) } }),
  });

  return {
    raw,
    prepare: (sql: string) => stmt(sql),
    batch: async (statements: SqlStatement[]) => {
      raw.exec("BEGIN");
      try {
        const out = statements.map((s) => {
          const { sql, params } = s as unknown as { sql: string; params: SqlValue[] };
          return { meta: { changes: Number(raw.prepare(sql).run(...params).changes) } };
        });
        raw.exec("COMMIT");
        return out;
      } catch (err) {
        raw.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

/** Datos mínimos: admin, dos clientes con pedidos, dos repartidores. */
export function seed(db: { raw: DatabaseSync }) {
  const now = "2026-11-12T12:00:00.000Z";
  const u = db.raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`);
  u.run("u-admin", "admin@x.test", "admin", now, now);
  u.run("u-ana", "ana@x.test", "cliente", now, now);
  u.run("u-beto", "beto@x.test", "cliente", now, now);
  u.run("u-rep1", "rep1@x.test", "repartidor", now, now);
  u.run("u-rep2", "rep2@x.test", "repartidor", now, now);
  const c = db.raw.prepare("INSERT INTO clients (id, user_id, name, total_points) VALUES (?, ?, ?, ?)");
  c.run("c-ana", "u-ana", "Ana", 0);
  c.run("c-beto", "u-beto", "Beto", 0);
  const o = db.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc, total_cents, courier_user_id, courier_name) VALUES (?, ?, ?, ?, ?, ?, ?)");
  o.run("o-ana-1", "c-ana", "Finalizados", "Pizza", 1250050, null, null);
  o.run("o-ana-2", "c-ana", "En Camino", "Empanadas", 500000, "u-rep1", "Rep Uno");
  o.run("o-beto-1", "c-beto", "En Camino", "Milanesa", 700000, "u-rep2", "Rep Dos");
  o.run("o-libre", "c-beto", "En Preparación", "Flan", 150000, null, null);
  const it = db.raw.prepare("INSERT INTO order_items (id, order_id, name, qty, unit_price_cents) VALUES (?, ?, ?, ?, ?)");
  it.run("i-ana", "o-ana-1", "Pizza", 1, 1250050);
  it.run("i-beto", "o-beto-1", "Milanesa", 1, 700000);
  db.raw.prepare("INSERT INTO points_ledger (id, client_id, delta, description) VALUES (?, ?, ?, ?)").run("l-ana", "c-ana", 100, "alta");
  db.raw.prepare("INSERT INTO points_ledger (id, client_id, delta, description) VALUES (?, ?, ?, ?)").run("l-beto", "c-beto", 50, "alta");
  db.raw.prepare("INSERT INTO reviews (id, order_id, client_id, rating) VALUES (?, ?, ?, ?)").run("r-beto", "o-beto-1", "c-beto", 4);
  db.raw.prepare("INSERT INTO couriers (user_id, name, pin_hash) VALUES (?, ?, ?)").run("u-rep1", "Rep Uno", "hash-1");
  db.raw.prepare("INSERT INTO global_config (key, value) VALUES (?, ?)").run("store", JSON.stringify({ open: true }));
  db.raw.prepare("INSERT INTO categories (id, name) VALUES (?, ?)").run("cat-1", "Pizzas");
  db.raw.prepare("INSERT INTO products (id, category_id, name, price_cents, is_active, show_in_portal) VALUES (?, ?, ?, ?, ?, 1)").run("p-on", "cat-1", "Muzza", 1000000, 1);
  db.raw.prepare("INSERT INTO products (id, category_id, name, price_cents, is_active) VALUES (?, ?, ?, ?, ?)").run("p-off", "cat-1", "Oculta", 1000000, 0);
  db.raw
    .prepare("INSERT INTO payment_intents (id, client_id, channel, total_cents, snapshot, expires_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run("pi-ana", "c-ana", "web", 1250050, "{}", "2099-01-01T00:00:00.000Z");
}

export const actors = {
  anon: { kind: "anon" } as const,
  admin: { kind: "admin", userId: "u-admin" } as const,
  ana: { kind: "cliente", userId: "u-ana" } as const,
  beto: { kind: "cliente", userId: "u-beto" } as const,
  rep1: { kind: "repartidor", userId: "u-rep1" } as const,
  rep2: { kind: "repartidor", userId: "u-rep2" } as const,
  system: { kind: "system", reason: "test" } as const,
};
