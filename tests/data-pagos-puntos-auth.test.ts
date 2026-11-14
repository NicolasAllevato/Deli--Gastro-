/**
 * Fase 2, tanda 3: copia a D1 de pagos (Mercado Pago), puntos y usuarios de
 * Supabase Auth (para Better Auth). Roles solo de app_metadata (G18).
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { authUserRow, mirrorAuthUsers, mirrorCourierRow, mirrorRows } from "../src/lib/data/mirror.ts";

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});
const get = (sql: string, ...p: string[]) => ({ ...(db.raw.prepare(sql).get(...p) as Record<string, unknown>) });

describe("pagos de Mercado Pago", () => {
  it("intención en centavos con snapshot JSON; la versión de D1 no se pisa", async () => {
    const intent = {
      id: "00000000-0000-4000-8000-000000001001", client_id: "c-ana", channel: "web", status: "pending",
      total: "12500.50", snapshot: { lines: [{ id: "p-on", qty: 1 }] }, expires_at: "2026-11-13T19:00:00.000Z",
    };
    await mirrorRows(db, actors.system, "payment_intents", [intent]);
    await mirrorRows(db, actors.system, "payment_intents", [{ ...intent, status: "approved", mp_payment_id: "mp-9" }]);
    const r = get("SELECT total_cents, status, mp_payment_id, version, snapshot FROM payment_intents WHERE id = ?", intent.id);
    assert.equal(r.total_cents, 1250050);
    assert.equal(r.status, "approved");
    assert.equal(r.mp_payment_id, "mp-9");
    assert.equal(r.version, 0, "la concurrencia optimista de D1 no la maneja el espejo");
    assert.deepEqual(JSON.parse(String(r.snapshot)), intent.snapshot);
  });
});

describe("puntos: asiento y saldo absoluto", () => {
  it("el trigger suma el asiento y el cliente copiado deja el saldo de Supabase", async () => {
    const asiento = { id: "00000000-0000-4000-8000-000000001101", client_id: "c-ana", order_id: "o-ana-1", delta: 25, description: "pedido" };
    await mirrorRows(db, actors.system, "points_ledger", [asiento]);
    assert.equal(get("SELECT total_points FROM clients WHERE id = 'c-ana'").total_points, 125);
    // Supabase dice que el saldo es 125: copiar el cliente lo confirma (absoluto, no suma).
    await mirrorRows(db, actors.system, "clients", [{ id: "c-ana", name: "Ana", total_points: 125, tier: "Plata" }]);
    assert.deepEqual(get("SELECT total_points, tier FROM clients WHERE id = 'c-ana'"), { total_points: 125, tier: "Plata" });
  });
  it("re-copiar un asiento no lo vuelve a sumar", async () => {
    const asiento = { id: "00000000-0000-4000-8000-000000001102", client_id: "c-ana", delta: 10, description: "x" };
    await mirrorRows(db, actors.system, "points_ledger", [asiento]);
    await mirrorRows(db, actors.system, "points_ledger", [asiento]);
    assert.equal(get("SELECT total_points FROM clients WHERE id = 'c-ana'").total_points, 110);
  });
  it("un canje que dejaría negativo en D1 falla (CHECK) y no deja el saldo negativo", async () => {
    await assert.rejects(mirrorRows(db, actors.system, "points_ledger", [{ id: "00000000-0000-4000-8000-000000001103", client_id: "c-beto", delta: -500, description: "canje" }]));
    assert.equal(get("SELECT total_points FROM clients WHERE id = 'c-beto'").total_points, 50);
  });
});

describe("usuarios de Supabase Auth → \"user\" de Better Auth", () => {
  const base = { id: "00000000-0000-4000-8000-000000001201", email: "Admin@X.test", email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z" };

  it("el rol sale solo de app_metadata; user_metadata no da permisos", () => {
    assert.equal(authUserRow({ ...base, app_metadata: { role: "admin" } }).role, "admin");
    assert.equal(authUserRow({ ...base, app_metadata: { role: "superadmin" } }).role, "cliente");
    assert.equal(authUserRow({ ...base, app_metadata: {}, user_metadata: { role: "admin" } }).role, "cliente");
    assert.equal(authUserRow({ ...base, app_metadata: { role: "repartidor" } }).role, "repartidor");
  });
  it("sin contraseña, email en minúsculas y bloqueo vigente", () => {
    const row = authUserRow({ ...base, banned_until: "2099-01-01T00:00:00Z" }, new Date("2026-11-13T00:00:00Z"));
    assert.equal(row.email, "admin@x.test");
    assert.equal(row.banned, 1);
    assert.ok(!("password" in row) && !("encrypted_password" in row));
    assert.equal(authUserRow({ ...base, banned_until: "2020-01-01T00:00:00Z" }).banned, 0);
  });
  it("copia idempotente; habilita la copia del repartidor (FK)", async () => {
    const courier = { ...base, id: "00000000-0000-4000-8000-000000001202", email: "rep@x.test", app_metadata: { role: "repartidor" } };
    await mirrorAuthUsers(db, actors.system, [courier]);
    await mirrorAuthUsers(db, actors.system, [{ ...courier, user_metadata: { name: "Rep Nuevo" } }]);
    assert.deepEqual(get(`SELECT role, name, emailVerified FROM "user" WHERE id = ?`, courier.id), { role: "repartidor", name: "Rep Nuevo", emailVerified: 1 });
    await mirrorCourierRow(db, actors.system, { user_id: courier.id, name: "Rep Nuevo", pin_hash: "h-nuevo", active: true });
    assert.equal(get("SELECT name FROM couriers WHERE user_id = ?", courier.id).name, "Rep Nuevo");
    // No hay cuenta con contraseña: el usuario la define al entrar (D3).
    assert.equal(get(`SELECT count(*) n FROM "account" WHERE userId = ?`, courier.id).n, 0);
  });
  it("solo el servidor", async () => {
    for (const a of [actors.anon, actors.ana, actors.rep1]) await assert.rejects(mirrorAuthUsers(db, a, [base]), ForbiddenError);
  });
});
