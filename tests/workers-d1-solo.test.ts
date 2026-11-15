/**
 * D1 como única fuente: con DATA_BACKEND=d1 los Workers leen y escriben solo en el binding D1
 * (sin PostgREST, sin Hyperdrive, sin SUPABASE_*). Los triggers de live_versions (0006) se disparan.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { createTestDb, seed } from "./helpers/sqlite-d1.ts";

const { syncDailyReport } = await import("../workers/finanzas-sync/src/report.ts");
const { handleOrderWebhook } = await import("../workers/pedidos-webhook/src/handler.ts");
const { rest, claimOrder, markSent } = await import("../workers/fudo-gateway/src/db.ts");

let db: ReturnType<typeof createTestDb>;
const realFetch = globalThis.fetch;
const noSupabase = (async () => { throw new Error("no debería llamar a Supabase"); }) as typeof fetch;
const version = (topic: string) =>
  (db.raw.prepare("SELECT version FROM live_versions WHERE topic = ?").get(topic) as { version: number } | undefined)?.version ?? 0;

beforeEach(() => {
  db = createTestDb();
  seed(db);
  globalThis.fetch = noSupabase;
});
afterEach(() => { globalThis.fetch = realFetch; });

describe("finanzas-sync en modo d1", () => {
  it("agrega los pedidos del día en reports_daily sin Supabase, y la segunda corrida actualiza", async () => {
    const now = new Date("2026-11-14T15:00:00.000Z");
    db.raw.prepare("UPDATE orders SET created_at = '2026-11-14T10:00:00.000Z'").run();
    db.raw.prepare("UPDATE orders SET status = 'Cancelado' WHERE id = 'o-libre'").run();
    const env = { DATA_BACKEND: "d1", DB: db };
    await syncDailyReport(env, now);
    const row = db.raw.prepare("SELECT * FROM reports_daily WHERE report_date = '2026-11-14'").get() as Record<string, number>;
    assert.equal(row.total_orders, 4);
    assert.equal(row.orders_cancelled, 1);
    assert.equal(row.total_income_cents, 1250050 + 500000 + 700000);
    db.raw.prepare("UPDATE orders SET status = 'Cancelado' WHERE id = 'o-ana-2'").run();
    await syncDailyReport(env, now);
    const rows = db.raw.prepare("SELECT * FROM reports_daily").all() as Record<string, number>[];
    assert.equal(rows.length, 1);
    assert.equal(rows[0].orders_cancelled, 2);
  });

  it("d1 sin binding falla cerrado (no cae a Supabase)", async () => {
    await assert.rejects(syncDailyReport({ DATA_BACKEND: "d1" }, new Date()), /binding/);
  });
});

describe("pedidos-webhook en modo d1", () => {
  const SECRET = "s".repeat(40);
  const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("hex");
  const req = (body: string, signature: string | null) =>
    new Request("https://x/", { method: "POST", body, headers: signature ? { "x-webhook-signature": signature } : {} });
  const env = () => ({ DATA_BACKEND: "d1", DB: db, WEBHOOK_SECRET: SECRET });
  const count = () => (db.raw.prepare("SELECT count(*) AS n FROM orders").get() as { n: number }).n;

  it("autorización: sin firma o con firma inválida responde 401 y no escribe", async () => {
    const body = JSON.stringify({ items_desc: "Pizza", total: 10 });
    assert.equal((await handleOrderWebhook(req(body, null), env())).status, 401);
    assert.equal((await handleOrderWebhook(req(body, sign("otro")), env())).status, 401);
    assert.equal(count(), 4);
  });

  it("autorización: sin WEBHOOK_SECRET configurado rechaza todo", async () => {
    const body = JSON.stringify({ items_desc: "Pizza", total: 10 });
    const res = await handleOrderWebhook(req(body, createHmac("sha256", "").update(body).digest("hex")), { ...env(), WEBHOOK_SECRET: "" });
    assert.equal(res.status, 401);
  });

  it("solo POST", async () => {
    assert.equal((await handleOrderWebhook(new Request("https://x/"), env())).status, 405);
  });

  it("con firma válida inserta en D1 (montos en centavos) y sube live_versions", async () => {
    const before = version("orders");
    const body = JSON.stringify({ client_id: null, items_desc: "Pizza", total: 1234.5 });
    const res = await handleOrderWebhook(req(body, sign(body)), env());
    assert.equal(res.status, 201);
    const json = (await res.json()) as { success: boolean; data: { id: string; total: number }[] };
    assert.equal(json.success, true);
    const row = db.raw.prepare("SELECT total_cents, status FROM orders WHERE id = ?").get(json.data[0].id) as { total_cents: number; status: string };
    assert.deepEqual({ ...row }, { total_cents: 123450, status: "Recibidos" });
    assert.equal(version("orders"), before + 1);
  });

  it("payload inválido → 400 sin escribir", async () => {
    const body = JSON.stringify({ items_desc: "", total: -1 });
    assert.equal((await handleOrderWebhook(req(body, sign(body)), env())).status, 400);
    assert.equal(count(), 4);
  });
});

describe("fudo-gateway en modo d1: pedido completo y triggers", () => {
  it("claimOrder lee el pedido con cliente e ítems desde D1 y markSent sube live_versions", async () => {
    db.raw.prepare("UPDATE orders SET fudo_sync_status = 'pending' WHERE id = 'o-ana-1'").run();
    const env = { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", DATA_BACKEND: "d1", DB: db };
    const claimed = await claimOrder(env, "o-ana-1");
    assert.ok(claimed);
    assert.equal(claimed.attempts, 1);
    assert.equal(claimed.order.total, 12500.5);
    assert.equal(claimed.order.client?.name, "Ana");
    assert.equal(claimed.order.items.length, 1);
    assert.equal(await claimOrder(env, "o-ana-1").then((c) => c?.attempts), 2);
    const before = version("order:o-ana-1");
    await markSent(env, "o-ana-1", 991);
    assert.ok(version("order:o-ana-1") > before);
    const events = await rest<{ event: string }[]>(env, "order_events?order_id=eq.o-ana-1&select=event");
    assert.ok(events.some((e) => e.event === "fudo_enviado"));
  });
});
