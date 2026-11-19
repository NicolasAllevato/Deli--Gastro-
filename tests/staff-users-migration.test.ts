/** Migración 0018: columnas nuevas, backfill de admins existentes como dueños y CHECK del rol. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const SCHEMA = readFileSync(new URL("../d1/schema/0001_inicial.sql", import.meta.url), "utf8");
const DIR = new URL("../d1/migrations/", import.meta.url);
const MIGRATION = "0018_user_staff_role_permissions.sql";

function dbBefore0018() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION).sort()) raw.exec(readFileSync(new URL(f, DIR), "utf8"));
  return raw;
}

describe("migración 0018 (staff_role y permissions)", () => {
  it("existe como 0018 y no hay otra con ese número", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".sql")).sort();
    assert.ok(names.includes(MIGRATION));
    assert.equal(names.filter((n) => n.startsWith("0018_")).length, 1);
  });

  it("los admins existentes quedan como dueños; el resto sin rol de personal", () => {
    const raw = dbBefore0018();
    const now = new Date().toISOString();
    const ins = raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)`);
    ins.run("a1", "a1@x.test", "admin", now, now);
    ins.run("a2", "a2@x.test", "admin", now, now);
    ins.run("c1", "c1@x.test", "cliente", now, now);
    ins.run("r1", "r1@x.test", "repartidor", now, now);
    raw.exec(readFileSync(new URL(MIGRATION, DIR), "utf8"));
    const rows = (raw.prepare(`SELECT id, staff_role, permissions FROM "user" ORDER BY id`).all() as Array<{ id: string; staff_role: string | null; permissions: string | null }>).map((r) => ({ ...r }));
    assert.deepEqual(rows, [
      { id: "a1", staff_role: "admin", permissions: null },
      { id: "a2", staff_role: "admin", permissions: null },
      { id: "c1", staff_role: null, permissions: null },
      { id: "r1", staff_role: null, permissions: null },
    ]);
  });

  it("el CHECK solo admite admin, gerente o cajero", () => {
    const raw = dbBefore0018();
    raw.exec(readFileSync(new URL(MIGRATION, DIR), "utf8"));
    const now = new Date().toISOString();
    const ins = raw.prepare(`INSERT INTO "user" (id, email, role, staff_role, createdAt, updatedAt) VALUES (?, ?, 'admin', ?, ?, ?)`);
    for (const ok of ["admin", "gerente", "cajero"]) ins.run(`u-${ok}`, `${ok}@x.test`, ok, now, now);
    assert.throws(() => ins.run("u-malo", "malo@x.test", "jefe", now, now), /CHECK constraint/);
  });
});
