/**
 * Fase 2, tanda WhatsApp y Fudo: espejo D1 de lo que escriben los Workers
 * (fudo-gateway por PostgREST, whatsapp-bot por SQL), incluidas las columnas
 * nuevas de order_items (031 / D1 0003).
 */
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError } from "../src/lib/data/actor.ts";
import { mirrorRows, WORKER_TABLES } from "../src/lib/data/mirror.ts";

const { rest } = await import("../workers/fudo-gateway/src/db.ts");
const { mirroredTable, withRepresentation, mirrorEnabled } = await import("../workers/fudo-gateway/src/d1-mirror.ts");
const { mirrorInboundRepo, mirrorBotRepo, botMirrorEnabled } = await import("../workers/whatsapp-bot/src/repo/d1-mirror.ts");

let db: ReturnType<typeof createTestDb>;
beforeEach(() => {
  db = createTestDb();
  seed(db);
});
const count = (sql: string, ...p: (string | number)[]) => (db.raw.prepare(sql).get(...p) as { n: number }).n;

describe("mirrorRows (tablas de los Workers)", () => {
  it("order_items con las columnas de Fudo (0003): centavos, JSON y booleano", async () => {
    await mirrorRows(db, actors.system, "order_items", [{
      id: "00000000-0000-4000-8000-000000000401", order_id: "o-ana-1", product_id: "p-on", name: "Combo", qty: 2,
      unit_price: "1500.50", created_at: "2026-11-13T18:23:27.000Z", fudo_product_id: 77, fudo_comment: "sin sal",
      fudo_options: [{ qty: 1, name: "Muzza" }], is_combo: true, columna_desconocida: "x",
    }]);
    const r = db.raw.prepare("SELECT unit_price_cents, fudo_options, is_combo, fudo_comment FROM order_items WHERE id = ?")
      .get("00000000-0000-4000-8000-000000000401") as Record<string, unknown>;
    assert.equal(r.unit_price_cents, 150050);
    assert.deepEqual(JSON.parse(String(r.fudo_options)), [{ qty: 1, name: "Muzza" }]);
    assert.equal(r.is_combo, 1);
    assert.equal(r.fudo_comment, "sin sal");
  });
  it("productos y categorías de Fudo, idempotente", async () => {
    const cat = { id: "00000000-0000-4000-8000-000000000501", name: "Fudo", fudo_id: 9, source: "fudo", is_active: true };
    const prod = { id: "00000000-0000-4000-8000-000000000502", category_id: cat.id, name: "Napo", price: 9900, fudo_id: 10, source: "fudo", is_active: true };
    await mirrorRows(db, actors.system, "categories", [cat]);
    await mirrorRows(db, actors.system, "products", [prod]);
    await mirrorRows(db, actors.system, "products", [{ ...prod, price: "10500.00", is_active: false }]);
    const p = db.raw.prepare("SELECT price_cents, is_active FROM products WHERE id = ?").get(prod.id) as Record<string, unknown>;
    assert.deepEqual({ ...p }, { price_cents: 1050000, is_active: 0 });
  });
  it("clientes de Fudo recalculan phone_digits; fechas Date a ISO", async () => {
    await mirrorRows(db, actors.system, "clients", [{
      id: "00000000-0000-4000-8000-000000000601", name: "Lu", phone: "+54 9 11 5555-4444", source: "fudo", fudo_customer_id: 321,
      created_at: new Date("2026-11-13T18:23:27Z"),
    }]);
    const c = db.raw.prepare("SELECT phone_digits, created_at FROM clients WHERE id = ?").get("00000000-0000-4000-8000-000000000601") as Record<string, unknown>;
    assert.deepEqual({ ...c }, { phone_digits: "1155554444", created_at: "2026-11-13T18:23:27.000Z" });
  });
  it("conversaciones y mensajes de WhatsApp", async () => {
    const conv = { id: "00000000-0000-4000-8000-000000000701", client_phone: "5491155554444", state: { paso: 1 }, human_takeover: false };
    await mirrorRows(db, actors.system, "wa_conversations", [conv]);
    await mirrorRows(db, actors.system, "wa_messages", [{ id: "00000000-0000-4000-8000-000000000702", conversation_id: conv.id, wamid: "w1", direction: "in", type: "text", body: "hola" }]);
    assert.equal(count("SELECT count(*) n FROM wa_messages WHERE wamid = 'w1'"), 1);
  });
  it("tabla fuera de la lista blanca, fila sin clave y actores no staff se rechazan", async () => {
    await assert.rejects(mirrorRows(db, actors.system, "user", [{ id: "x" }]), /no permitida/);
    await assert.rejects(mirrorRows(db, actors.system, "__proto__", [{ id: "x" }]), /no permitida/);
    await assert.rejects(mirrorRows(db, actors.system, "categories", [{ name: "sin id" }]), /sin clave/);
    for (const a of [actors.anon, actors.ana, actors.rep1]) await assert.rejects(mirrorRows(db, a, "categories", [{ id: "x" }]), ForbiddenError);
    assert.ok(!("integration_secrets" in WORKER_TABLES) && !("couriers" in WORKER_TABLES), "los Workers no copian secretos ni PIN");
  });
});

describe("fudo-gateway: rest() copia a D1 en modo dual", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = realFetch; });

  it("pide las filas a PostgREST, las copia a D1 y al que pidió return=minimal le devuelve lo mismo que antes", async () => {
    let sentPrefer = "";
    const row = { id: "00000000-0000-4000-8000-000000000801", order_id: "o-ana-1", event: "fudo_enviado", actor: "fudo", detail: "1", created_at: "2026-11-13T18:00:00.000Z" };
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sentPrefer = (init.headers as Record<string, string>).prefer;
      return new Response(JSON.stringify([row]), { status: 201 });
    }) as typeof fetch;
    const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", DATA_BACKEND: "dual", DB: db };
    const out = await rest(env, "order_events", { method: "POST", headers: { prefer: "return=minimal" }, body: "{}" });
    assert.equal(out, undefined);
    assert.equal(sentPrefer, "return=representation");
    assert.equal(count("SELECT count(*) n FROM order_events WHERE id = ?", row.id), 1);
  });
  it("con DATA_BACKEND=supabase no toca D1 ni el Prefer", async () => {
    let sentPrefer = "";
    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      sentPrefer = (init.headers as Record<string, string>).prefer;
      return new Response(null, { status: 204 });
    }) as typeof fetch;
    await rest({ SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k", DATA_BACKEND: "supabase", DB: db }, "order_events", {
      method: "POST", headers: { prefer: "resolution=merge-duplicates,return=minimal" }, body: "{}",
    });
    assert.equal(sentPrefer, "resolution=merge-duplicates,return=minimal");
  });
  it("si D1 falla, el sync sigue", async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify([{ id: "00000000-0000-4000-8000-000000000802", order_id: "no-existe", event: "x" }]), { status: 201 })) as typeof fetch;
    const out = await rest({ SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k", DATA_BACKEND: "dual", DB: db }, "order_events", { method: "POST", body: "{}" });
    assert.ok(Array.isArray(out));
  });
  it("helpers", () => {
    assert.equal(mirroredTable("orders?id=eq.1"), "orders");
    assert.equal(mirroredTable("fudo_payment_map?select=*"), null);
    assert.equal(withRepresentation("resolution=merge-duplicates,return=minimal"), "resolution=merge-duplicates,return=representation");
    assert.equal(mirrorEnabled({ DATA_BACKEND: "dual" }), false, "sin binding no copia");
  });
});

describe("whatsapp-bot: relectura acotada", () => {
  it("teléfono sin 10 dígitos no relee clientes; las consultas por teléfono llevan LIMIT", async () => {
    const { sqlMirrorReader } = await import("../workers/whatsapp-bot/src/repo/d1-mirror-sql.ts");
    const queries: string[] = [];
    const fakeSql = ((strings: TemplateStringsArray) => {
      queries.push(strings.join("?"));
      return Promise.resolve([]);
    }) as never;
    const reader = sqlMirrorReader(fakeSql);
    assert.deepEqual(await reader.clientsByPhoneTail("12345"), []);
    assert.deepEqual(await reader.clientsByPhoneTail(""), []);
    assert.equal(queries.length, 0, "no consulta con un teléfono corto");
    await reader.clientsByPhoneTail("+54 9 11 5555-4444");
    await reader.conversationsSharingTail("00000000-0000-4000-8000-000000000901");
    assert.ok(queries.every((q) => /limit \?/i.test(q)), "todas con LIMIT");
  });
});

describe("whatsapp-bot: repos con espejo", () => {
  const conv = { id: "00000000-0000-4000-8000-000000000901", client_phone: "5491155554444", human_takeover: true };
  const msg = { id: "00000000-0000-4000-8000-000000000902", conversation_id: conv.id, wamid: "w9", direction: "out", type: "text", body: "hola" };
  const reader = {
    conversationsById: async () => [conv],
    conversationsSharingTail: async () => [conv],
    messagesByWamid: async () => [msg],
    clientsByPhoneTail: async () => [],
  };
  const inbound = {
    upsertConversation: async () => ({ id: conv.id, phone: conv.client_phone, humanTakeover: true }),
    saveInbound: async () => true,
    updateStatus: async () => {},
    hasOutbound: async () => false,
    ensureConversation: async () => ({ id: conv.id, phone: conv.client_phone, humanTakeover: true }),
    pauseBot: async () => 1,
    saveEcho: async () => true,
    takeoverMinutes: async () => 120,
  };

  it("sin modo dual devuelve el mismo repo", () => {
    assert.equal(mirrorInboundRepo(inbound as never, { DATA_BACKEND: "supabase", D1: db }, reader), inbound);
    assert.equal(botMirrorEnabled({ DATA_BACKEND: "dual" }), false);
  });
  it("en dual copia conversación y mensaje después de escribir", async () => {
    const repo = mirrorInboundRepo(inbound as never, { DATA_BACKEND: "dual", D1: db }, reader);
    await repo.upsertConversation("5491155554444", null);
    await repo.saveEcho(conv.id, { wamid: "w9", type: "text", body: "hola" });
    assert.equal(count("SELECT count(*) n FROM wa_conversations WHERE id = ?", conv.id), 1);
    assert.equal(count("SELECT count(*) n FROM wa_messages WHERE wamid = 'w9'"), 1);
  });
  it("un fallo al copiar no rompe el bot", async () => {
    const broken = { ...reader, conversationsById: async () => { throw new Error("D1_ERROR"); } };
    const bot = mirrorBotRepo({ setTakeover: async () => {}, setMarketingOptIn: async () => 0, saveOutbound: async () => {}, saveTranscript: async () => {} } as never, { DATA_BACKEND: "dual", D1: db }, broken);
    await bot.setTakeover(conv.id);
  });
});
