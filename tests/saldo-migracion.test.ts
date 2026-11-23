/** Migración 0024 (saldo a favor): columnas, ledger con trigger, y que reconstruir `reclamos` no borre el historial. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

const SCHEMA = readFileSync(new URL("../d1/schema/0001_inicial.sql", import.meta.url), "utf8");
const DIR = new URL("../d1/migrations/", import.meta.url);
const MIGRATION = "0024_saldo_a_favor.sql";

function dbBefore() {
  const raw = new DatabaseSync(":memory:");
  raw.exec("PRAGMA foreign_keys = ON;");
  raw.exec(SCHEMA);
  for (const f of readdirSync(DIR).filter((n) => n.endsWith(".sql") && n < MIGRATION).sort()) raw.exec(readFileSync(new URL(f, DIR), "utf8"));
  return raw;
}
const migrate = (raw: DatabaseSync) => raw.exec(readFileSync(new URL(MIGRATION, DIR), "utf8"));

function seedReclamos(raw: DatabaseSync) {
  raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Ana')");
  const rec = raw.prepare("INSERT INTO reclamos (id, numero, conversation_id, client_phone, client_id, motivo, estado, compensacion_tipo, compensacion_valor, sugerencia) VALUES (?, ?, ?, '5491100000000', 'c1', 'llegó frío', ?, ?, ?, ?)");
  rec.run("r1", 1, "conv1", "resuelto", "descuento", 10, '{"a":1}');
  rec.run("r2", 2, "conv2", "abierto", null, null, null);
  const ev = raw.prepare("INSERT INTO reclamos_eventos (id, reclamo_id, tipo, detalle, autor) VALUES (?, ?, ?, ?, ?)");
  ev.run("e1", "r1", "creado", "uno", "bot");
  ev.run("e2", "r1", "compensacion", "dos", "admin");
  ev.run("e3", "r2", "creado", "tres", "bot");
}

describe("migración 0024 (saldo a favor)", () => {
  it("existe como 0024 y no hay otra con ese número", () => {
    const names = readdirSync(DIR).filter((n) => n.endsWith(".sql"));
    assert.equal(names.filter((n) => n.startsWith("0024_")).length, 1);
  });

  it("los eventos de reclamos sobreviven a la reconstrucción de la tabla", () => {
    const raw = dbBefore();
    seedReclamos(raw);
    migrate(raw);
    const eventos = (raw.prepare("SELECT id, reclamo_id, detalle FROM reclamos_eventos ORDER BY id").all() as Array<Record<string, string>>).map((r) => ({ ...r }));
    assert.deepEqual(eventos, [
      { id: "e1", reclamo_id: "r1", detalle: "uno" },
      { id: "e2", reclamo_id: "r1", detalle: "dos" },
      { id: "e3", reclamo_id: "r2", detalle: "tres" },
    ]);
    // Los datos y columnas del reclamo también se conservan (incluidas las de la 0017).
    const r1 = raw.prepare("SELECT compensacion_tipo, compensacion_valor, sugerencia FROM reclamos WHERE id = 'r1'").get() as Record<string, unknown>;
    assert.deepEqual({ ...r1 }, { compensacion_tipo: "descuento", compensacion_valor: 10, sugerencia: '{"a":1}' });
    assert.equal((raw.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = '_reclamos_eventos_bak'").get() as { n: number }).n, 0);
    // El CASCADE sigue vigente después de la migración.
    raw.exec("DELETE FROM reclamos WHERE id = 'r2'");
    assert.equal((raw.prepare("SELECT count(*) AS n FROM reclamos_eventos").get() as { n: number }).n, 2);
  });

  it("reclamos admite 'saldo' y mantiene puntos, descuento y la pareja tipo/valor", () => {
    const raw = dbBefore();
    seedReclamos(raw);
    migrate(raw);
    const upd = raw.prepare("UPDATE reclamos SET compensacion_tipo = ?, compensacion_valor = ? WHERE id = 'r2'");
    for (const tipo of ["saldo", "puntos", "descuento"]) upd.run(tipo, 5);
    assert.throws(() => upd.run("regalo", 5), /CHECK constraint/);
    assert.throws(() => upd.run("saldo", null), /CHECK constraint/);
  });

  it("el ledger suma al saldo, es idempotente y el CHECK frena el saldo negativo", () => {
    const raw = dbBefore();
    migrate(raw);
    raw.exec("INSERT INTO clients (id, name) VALUES ('c1', 'Ana')");
    const ins = raw.prepare("INSERT INTO credit_ledger (id, client_id, delta_cents, motivo, idempotency_key) VALUES (?, 'c1', ?, ?, ?)");
    ins.run("l1", 500000, "reclamo", "reclamo:r1:saldo");
    assert.throws(() => ins.run("l2", 1, "reclamo", "reclamo:r1:saldo"), /UNIQUE/);
    const saldo = () => (raw.prepare("SELECT credit_cents AS c FROM clients WHERE id = 'c1'").get() as { c: number }).c;
    assert.equal(saldo(), 500000);
    ins.run("l3", -200000, "compra", "orden:o1:credito");
    assert.equal(saldo(), 300000);
    assert.throws(() => ins.run("l4", -300001, "compra", "orden:o2:credito"), /CHECK constraint/);
    assert.equal(saldo(), 300000);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM credit_ledger").get() as { n: number }).n, 2);
    assert.throws(() => ins.run("l5", 0, "ajuste", "x"), /CHECK constraint/);
  });
});
