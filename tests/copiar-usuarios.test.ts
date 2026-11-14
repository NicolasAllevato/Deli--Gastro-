/**
 * Script de copia de usuarios Supabase Auth → "user" de Better Auth en D1:
 * roles solo de app_metadata, vínculos con clients y couriers, sin contraseñas,
 * idempotente y sin datos personales en el resumen.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed } from "./helpers/sqlite-d1.ts";

const { maskEmail, userSql, summarize, verifySql } = await import("../scripts/copiar-usuarios-d1.mjs");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const users = [
  { id: U(1), email: "Admin.Local@Gmail.com", phone: "+5491155554444", email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", app_metadata: { role: "admin" }, user_metadata: { name: "Admin" } },
  { id: U(2), email: "cliente@x.test", app_metadata: {}, user_metadata: { role: "admin", full_name: "Cli" } },
  { id: U(3), email: "rep@x.test", app_metadata: { role: "repartidor" } },
  { id: U(4), email: "raro@x.test", app_metadata: { role: "staff" } },
];

describe("copia de usuarios a D1", () => {
  it("emails enmascarados", () => {
    assert.equal(maskEmail("ana.perez@gmail.com"), "a***@g***.com");
    assert.equal(maskEmail(null), "(sin email)");
  });

  it("resumen por rol sin datos personales; avisa roles desconocidos y fichas inconsistentes", () => {
    const s = summarize(users, new Set([U(2), U(9)]), new Set([U(3), U(2)]));
    assert.deepEqual(s.porRol, { admin: 1, cliente: 2, repartidor: 1 });
    assert.equal(s.conCliente, 1);
    assert.equal(s.conRepartidor, 2);
    assert.deepEqual(s.huerfanos, { clients: 1, couriers: 0 });
    const texto = JSON.stringify(s);
    for (const pii of ["Admin.Local", "admin.local", "cliente@x.test", "5491155554444", "raro@x.test"]) assert.ok(!texto.includes(pii), pii);
    assert.ok(s.avisos.some((a: string) => a.includes("staff")), "rol staff avisado");
    assert.ok(s.avisos.some((a: string) => a.includes("ficha de repartidor pero rol cliente")));
  });

  it("el SQL generado se aplica en D1, es idempotente y no crea contraseñas", () => {
    const db = createTestDb();
    seed(db);
    const sql = userSql(users).join("\n");
    db.raw.exec(sql);
    db.raw.exec(sql);
    const rows = db.raw.prepare(`SELECT id, role, email, phone FROM "user" WHERE id IN (?, ?, ?, ?) ORDER BY id`).all(U(1), U(2), U(3), U(4)) as Record<string, unknown>[];
    assert.deepEqual(rows.map((r) => r.role), ["admin", "cliente", "repartidor", "cliente"]);
    assert.equal(rows[0].email, "admin.local@gmail.com");
    assert.equal(rows[0].phone, "+5491155554444");
    assert.equal((db.raw.prepare(`SELECT count(*) n FROM "account"`).get() as { n: number }).n, 0);
  });

  it("los chequeos de verificación corren en D1", () => {
    const db = createTestDb();
    seed(db);
    const s = summarize(users, new Set(), new Set());
    for (const q of verifySql(s)) assert.doesNotThrow(() => db.raw.prepare(q).all(), q);
  });

  it("un email con comilla no rompe el SQL (escapado)", () => {
    const db = createTestDb();
    db.raw.exec(userSql([{ id: U(5), email: "o'neil@x.test", app_metadata: { role: "cliente" } }]).join("\n"));
    assert.equal((db.raw.prepare(`SELECT email FROM "user" WHERE id = ?`).get(U(5)) as { email: string }).email, "o'neil@x.test");
  });
});
