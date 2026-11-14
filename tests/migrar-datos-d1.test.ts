/**
 * Copia completa Supabase → D1 (tanda 4): el SQL generado se carga en el esquema real
 * (con migraciones), es idempotente y la verificación de conteos y sumas da todo OK.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createTestDb } from "./helpers/sqlite-d1.ts";

const { construir } = await import("../scripts/migrar-datos-d1.mjs");

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const usuarios = [
  { id: U(1), email: "admin@x.test", email_confirmed_at: "2026-01-01T00:00:00Z", created_at: "2026-01-01T00:00:00Z", app_metadata: { role: "admin" } },
  { id: U(2), email: "ana@x.test", app_metadata: {}, created_at: "2026-02-01T00:00:00Z" },
  { id: U(3), email: "rep@x.test", app_metadata: { role: "repartidor" } },
];

const tablas: [string, Record<string, unknown>[]][] = [
  ["categories", [{ id: U(10), name: "Pizzas", is_active: true, created_at: "2026-01-01T00:00:00+00:00" }]],
  ["products", [{ id: U(11), category_id: U(10), name: "Muzza", price: "12500.50", is_active: true }]],
  ["clients", [{ id: U(20), user_id: U(2), name: "Ana", phone: "+54 9 11 5555-4444", total_points: 30, tier: "Bronce" }]],
  ["orders", [
    { id: U(30), client_id: U(20), status: "Finalizados", items_desc: "1x Muzza", total: "12500.50", delivery_fee: 800, courier_name: "Rep", created_at: "2026-11-13T18:23:27+00:00", delivered_in_app: true, fudo_payments: [{ name: "Efectivo", amount: 100 }] },
    { id: U(31), client_id: U(20), status: "Cancelado", items_desc: "1x Muzza", total: 9900.1, delivery_fee: 0, created_at: "2026-11-12T10:00:00+00:00" },
  ]],
  ["order_items", [{ id: U(40), order_id: U(30), product_id: U(11), name: "Muzza", qty: 1, unit_price: "12500.50", fudo_product_id: 7, fudo_comment: "sin sal", fudo_options: [{ qty: 1, name: "Extra" }], is_combo: false }]],
  ["points_ledger", [
    { id: U(50), client_id: U(20), order_id: U(30), delta: 50, description: "pedido", created_at: "2026-11-13T19:00:00+00:00" },
    { id: U(51), client_id: U(20), order_id: null, delta: -20, description: "canje", created_at: "2026-11-13T19:10:00+00:00" },
  ]],
  ["payment_intents", [{ id: U(60), client_id: U(20), channel: "web", status: "approved", total: "12500.50", snapshot: { x: 1 }, order_id: U(30), expires_at: "2026-11-13T19:00:00+00:00", mp_payment_id: "mp-1" }]],
  ["couriers", [{ user_id: U(3), name: "Rep", pin_hash: "h", active: true, pin_encrypted: null }]],
];

function cargar(db: ReturnType<typeof createTestDb>, sql: string[]) {
  // D1 aplica el archivo en lote; acá se ejecuta igual (sin BEGIN/COMMIT en el archivo).
  db.raw.exec(sql.join("\n"));
}

describe("copia completa a D1", () => {
  it("carga, verifica conteos y sumas, y es idempotente", () => {
    const db = createTestDb();
    const { lineas, verificar, sumas: rawSumas } = construir(usuarios, tablas);
    const sumas = rawSumas as unknown as Record<string, number>;
    cargar(db, lineas);
    cargar(db, lineas); // re-correr no duplica ni cambia sumas

    assert.equal(sumas["orders.total_cents"], 1250050 + 990010);
    assert.equal(sumas["order_items.unit_price_cents"], 1250050);
    assert.equal(sumas["points_ledger.delta"], 30);

    for (const q of verificar) {
      const rows = db.raw.prepare(q).all() as Record<string, unknown>[];
      if (q.startsWith("PRAGMA foreign_key_check")) assert.deepEqual(rows, [], "sin FKs rotas");
      else if (q.includes("saldo_distinto_del_ledger") || q.includes("puntos_inconsistentes") || q.includes("cuentas_con_password")) {
        for (const r of rows) assert.ok(!("id" in r) && Number(r.n ?? 0) === 0, q);
      } else {
        for (const r of rows) assert.equal(r.ok, 1, `${q} → ${JSON.stringify(r)}`);
      }
    }
  });

  it("deja dueño del pedido, pago ligado, saldo de origen, roles y sin contraseñas", () => {
    const db = createTestDb();
    cargar(db, construir(usuarios, tablas).lineas);
    const o = db.raw.prepare("SELECT courier_user_id, payment_intent_id, delivered_in_app, fudo_payments FROM orders WHERE id = ?").get(U(30)) as Record<string, unknown>;
    assert.equal(o.courier_user_id, U(3));
    assert.equal(o.payment_intent_id, U(60));
    assert.equal(o.delivered_in_app, 1);
    assert.deepEqual(JSON.parse(String(o.fudo_payments)), [{ name: "Efectivo", amount: 100 }]);
    assert.equal((db.raw.prepare("SELECT total_points FROM clients WHERE id = ?").get(U(20)) as { total_points: number }).total_points, 30);
    const roles = db.raw.prepare(`SELECT id, role FROM "user" ORDER BY id`).all() as { role: string }[];
    assert.deepEqual(roles.map((r) => r.role), ["admin", "cliente", "repartidor"]);
    assert.equal((db.raw.prepare(`SELECT count(*) n FROM "account"`).get() as { n: number }).n, 0);
    const item = db.raw.prepare("SELECT fudo_options, is_combo, unit_price_cents FROM order_items WHERE id = ?").get(U(40)) as Record<string, unknown>;
    assert.deepEqual({ ...item, fudo_options: JSON.parse(String(item.fudo_options)) }, { fudo_options: [{ qty: 1, name: "Extra" }], is_combo: 0, unit_price_cents: 1250050 });
  });

  it("descarta (y avisa) columnas que D1 no tiene, en vez de romper la carga", () => {
    const db = createTestDb();
    const conExtra: [string, Record<string, unknown>[]][] = [["categories", [{ id: U(10), name: "Pizzas", columna_nueva_en_supabase: "x" }]]];
    const { lineas, descartadas } = construir([], conExtra);
    assert.deepEqual(descartadas, ["categories.columna_nueva_en_supabase"]);
    assert.doesNotThrow(() => cargar(db, lineas));
    assert.ok(lineas.some((l: string) => l.startsWith('INSERT INTO "categories" ("id", "name")')), "identificadores entre comillas");
  });

  it("nunca copia tablas de recetas ni secretos", () => {
    const script = fileURLToPath(new URL("../scripts/migrar-datos-d1.mjs", import.meta.url));
    const recetas = spawnSync(process.execPath, ["--no-warnings", script, "--tablas", "recetas"], { encoding: "utf8", env: { ...process.env, SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" } });
    assert.notEqual(recetas.status, 0);
    assert.match(recetas.stderr, /fuera de la app/);
  });
});
