/**
 * Etapa 2 del corte: con DATA_BACKEND=d1 los Workers escriben directo en D1.
 * fudo-gateway: rest() traduce PostgREST → plan del motor. whatsapp-bot: repos sobre D1.
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed } from "./helpers/sqlite-d1.ts";

const { postgrestToPlan, restD1 } = await import("../workers/fudo-gateway/src/d1-rest.ts");
const { rest } = await import("../workers/fudo-gateway/src/db.ts");
const { d1InboundRepo, d1BotRepo } = await import("../workers/whatsapp-bot/src/repo/d1.ts");

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});

describe("fudo-gateway en modo d1", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("traduce los paths de PostgREST que usa el gateway", () => {
    const p = postgrestToPlan(`orders?fudo_sync_status=in.(pending,failed)&fudo_order_id=is.null&fudo_attempts=lt.6&select=id&order=created_at.asc&limit=20`);
    assert.equal(p.table, "orders");
    assert.deepEqual(p.filters, [
      { op: "in", column: "fudo_sync_status", value: ["pending", "failed"] },
      { op: "is", column: "fudo_order_id", value: null },
      { op: "lt", column: "fudo_attempts", value: "6" },
    ]);
    assert.deepEqual(p.order, [{ column: "created_at", ascending: true }]);
    assert.equal(p.limit, 20);
    const neg = postgrestToPlan("products?fudo_id=not.is.null&select=id");
    assert.deepEqual(neg.filters, [{ op: "not", column: "fudo_id", value: { op: "is", value: null } }]);
    const quoted = postgrestToPlan(`orders?status=in.(${encodeURIComponent('"En Preparación","En Camino"')})`);
    assert.deepEqual(quoted.filters[0].value, ["En Preparación", "En Camino"]);
    const up = postgrestToPlan("categories?on_conflict=fudo_id", { method: "POST", headers: { prefer: "return=representation,resolution=merge-duplicates" }, body: "[]" });
    assert.equal(up.action, "upsert");
    assert.equal(up.onConflict, "fudo_id");
  });

  it("rest() con DATA_BACKEND=d1 lee y escribe en D1 sin llamar a Supabase", async () => {
    globalThis.fetch = (async () => { throw new Error("no debería llamar a Supabase"); }) as typeof fetch;
    const env = { SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k", DATA_BACKEND: "d1", DB: db };
    const rows = await rest<{ id: string; total: number }[]>(env, "orders?id=eq.o-ana-1&select=id,total");
    assert.deepEqual(rows.map((r) => ({ ...r })), [{ id: "o-ana-1", total: 12500.5 }]);
    await rest(env, "orders?id=eq.o-ana-1", { method: "PATCH", headers: { prefer: "return=minimal" }, body: JSON.stringify({ fudo_sync_status: "sent", fudo_order_id: 77 }) });
    assert.equal((db.raw.prepare("SELECT fudo_order_id FROM orders WHERE id = 'o-ana-1'").get() as { fudo_order_id: number }).fudo_order_id, 77);
    const ev = await rest<unknown>(env, "order_events", { method: "POST", headers: { prefer: "return=minimal" }, body: JSON.stringify({ order_id: "o-ana-1", event: "fudo_enviado", actor: "fudo" }) });
    assert.equal(ev, undefined, "return=minimal sigue sin cuerpo");
    const embed = await rest<{ products: { name: string } }[]>(env, "fudo_product_map?select=fudo_product_id,product_id,products(name)");
    assert.ok(Array.isArray(embed));
  });

  it("un PATCH sin filtro no toca toda la tabla", async () => {
    await assert.rejects(restD1(db, "orders", { method: "PATCH", body: JSON.stringify({ status: "Cancelado" }) }), /21000/);
  });

  it("tablas y filtros fuera del subconjunto se rechazan", async () => {
    await assert.rejects(restD1(db, "integration_secrets?select=*", { method: "POST", body: "{}" }), /D5/);
    await assert.rejects(restD1(db, "user?select=*"), /42P01/);
    assert.throws(() => postgrestToPlan("orders?id=cs.{1}"), /no soportado/);
  });
});

describe("whatsapp-bot en modo d1", () => {
  const PHONE = "5491155554444";

  it("entrante: crea la conversación (una sola por teléfono) y guarda el mensaje sin duplicar", async () => {
    const repo = d1InboundRepo(db);
    db.raw.prepare("UPDATE clients SET phone = '+54 9 11 5555-4444', phone_digits = '1155554444' WHERE id = 'c-ana'").run();
    const a = await repo.upsertConversation(PHONE, "Ana WA");
    const b = await repo.upsertConversation("541155554444", "Otra");
    assert.equal(a.id, b.id, "mismos 10 dígitos → misma conversación");
    const conv = db.raw.prepare("SELECT client_id, contact_name FROM wa_conversations WHERE id = ?").get(a.id) as Record<string, unknown>;
    assert.deepEqual({ ...conv }, { client_id: "c-ana", contact_name: "Ana WA" });
    assert.equal(await repo.saveInbound(a.id, { wamid: "w1", type: "text", body: "hola" }), true);
    assert.equal(await repo.saveInbound(a.id, { wamid: "w1", type: "text", body: "hola" }), false, "reintento de Meta");
    await repo.updateStatus("w1", "read");
  });

  it("pausa fail-closed y nunca acorta una pausa más larga", async () => {
    const repo = d1InboundRepo(db);
    const conv = await repo.ensureConversation(PHONE);
    const largo = new Date(Date.now() + 3_600_000);
    await repo.pauseBot(conv.id, largo);
    await repo.pauseBot(conv.id, new Date(Date.now() + 60_000));
    const row = db.raw.prepare("SELECT bot_paused_until FROM wa_conversations WHERE id = ?").get(conv.id) as { bot_paused_until: string };
    assert.equal(row.bot_paused_until, largo.toISOString());
    assert.equal((await repo.upsertConversation(PHONE, null)).humanTakeover, true, "silenciada mientras dure la pausa");
  });

  it("bot: menú en pesos, historial, conteos, opt-in solo con 10 dígitos", async () => {
    const inbound = d1InboundRepo(db);
    const bot = d1BotRepo(db);
    const conv = await inbound.upsertConversation(PHONE, "Ana");
    await inbound.saveInbound(conv.id, { wamid: "w2", type: "text", body: "quiero una pizza" });
    await bot.saveOutbound(conv.id, "w3", "¡Hola!");
    await bot.saveOutbound(conv.id, "w3", "¡Hola!");
    assert.deepEqual((await bot.history(conv.id, 10)).map((h) => ({ ...h })), [
      { direction: "in", body: "quiero una pizza" },
      { direction: "out", body: "¡Hola!" },
    ]);
    assert.deepEqual(await bot.inboundCounts(conv.id), { lastMinute: 1, lastDay: 1 });
    const menu = await bot.menu();
    assert.deepEqual(menu.map((m) => [m.name, m.price]), [["Muzza", 10000]], "solo activos, en pesos");
    assert.equal(await bot.setMarketingOptIn("123", true), 0);
    // La migración 0023 siembra la config de la docena: se compara solo la clave que carga el test.
    const { docena_fudo_id, docena_unidades, empanada_gustos_map, ...cfg } = (await bot.config()) as Record<string, unknown>;
    assert.ok(docena_fudo_id === 212 && docena_unidades === 12 && empanada_gustos_map);
    assert.deepEqual(cfg, { store: { open: true } });
    assert.equal((await bot.getConversation(PHONE))?.id, conv.id);
    assert.equal((await bot.latestOrder("c-ana"))?.total !== undefined, true);
  });
});
