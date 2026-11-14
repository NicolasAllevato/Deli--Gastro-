/**
 * Etapa 4 del corte: versiones por topic (migración D1 0006) en lugar de Supabase Realtime.
 * Triggers que suman versión, autorización por topic y el poller de 5 s del navegador.
 */
import { describe, it, mock } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { liveVersions, parseTopics, MAX_TOPICS } from "../src/lib/data/live.ts";
import { createVersionPollers } from "../src/lib/live-poll.ts";

const ANA_ORDER = "11111111-1111-4111-8111-111111111111";
const BETO_ORDER = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

function setup() {
  const db = createTestDb();
  seed(db);
  const o = db.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc, total_cents) VALUES (?, ?, 'Recibidos', 'x', 100)");
  o.run(ANA_ORDER, "c-ana");
  o.run(BETO_ORDER, "c-beto");
  return db;
}

const version = (db: ReturnType<typeof setup>, topic: string) =>
  (db.raw.prepare("SELECT version FROM live_versions WHERE topic = ?").get(topic) as { version: number } | undefined)?.version ?? 0;

describe("live_versions (triggers)", () => {
  it("un pedido nuevo o actualizado suma en 'orders' y en 'order:<id>'", () => {
    const db = setup();
    const before = version(db, "orders");
    assert.ok(version(db, `order:${ANA_ORDER}`) >= 1);
    db.raw.prepare("UPDATE orders SET status = 'En Preparación' WHERE id = ?").run(ANA_ORDER);
    assert.ok(version(db, "orders") > before);
    assert.ok(version(db, `order:${ANA_ORDER}`) >= 2);
  });

  it("mensajes y conversaciones de WhatsApp, habilitaciones y campañas", () => {
    const db = setup();
    db.raw.prepare("INSERT INTO wa_conversations (id, client_phone) VALUES (?, '5491100000000')").run(CONV);
    db.raw.prepare("INSERT INTO wa_messages (id, conversation_id, direction, type, body) VALUES ('m1', ?, 'in', 'text', 'hola')").run(CONV);
    assert.ok(version(db, "wa_conversations") >= 2);
    assert.ok(version(db, `wa_conversation:${CONV}`) >= 2);
    db.raw.prepare(`INSERT INTO "user" (id, email, role, createdAt, updatedAt) VALUES ('u-rep9', 'r9@x.test', 'repartidor', 'x', 'x')`).run();
    db.raw.prepare("INSERT INTO courier_shifts (id, user_id, courier_name, shift_day) VALUES ('s1', 'u-rep9', 'R', '2026-11-14')").run();
    assert.equal(version(db, "courier_shifts"), 1);
    db.raw.prepare("INSERT INTO wa_campaigns (id, name, segment, message) VALUES ('k1', 'C', '{}', 'hola')").run();
    assert.equal(version(db, "wa_campaigns"), 1);
  });
});

describe("liveVersions: autorización por topic", () => {
  it("anon no ve ninguna versión", async () => {
    const db = setup();
    assert.deepEqual(await liveVersions(db, actors.anon, ["orders", `order:${ANA_ORDER}`]), { orders: 0, [`order:${ANA_ORDER}`]: 0 });
  });

  it("un cliente ve su pedido y no el de otro (que responde 0, sin revelar si existe)", async () => {
    const db = setup();
    const v = await liveVersions(db, actors.ana, [`order:${ANA_ORDER}`, `order:${BETO_ORDER}`, "orders", "wa_conversations"]);
    assert.ok(v[`order:${ANA_ORDER}`] >= 1);
    assert.equal(v[`order:${BETO_ORDER}`], 0);
    assert.equal(v.orders, 0);
    assert.equal(v.wa_conversations, 0);
  });

  it("el repartidor ve 'orders' y 'courier_shifts', no WhatsApp ni pedidos sueltos", async () => {
    const db = setup();
    const v = await liveVersions(db, actors.rep1, ["orders", "wa_conversations", `order:${ANA_ORDER}`]);
    assert.ok(v.orders >= 1);
    assert.equal(v.wa_conversations, 0);
    assert.equal(v[`order:${ANA_ORDER}`], 0);
  });

  it("el admin ve todo", async () => {
    const db = setup();
    const v = await liveVersions(db, actors.admin, ["orders", `order:${BETO_ORDER}`]);
    assert.ok(v.orders >= 2 && v[`order:${BETO_ORDER}`] >= 1);
  });
});

describe("parseTopics", () => {
  it("acepta solo topics conocidos, sin duplicados y con tope", () => {
    assert.deepEqual(parseTopics(`orders,orders,order:${ANA_ORDER}`), ["orders", `order:${ANA_ORDER}`]);
    assert.equal(parseTopics("orders,users"), null);
    assert.equal(parseTopics("order:1 OR 1=1"), null);
    assert.equal(parseTopics(""), null);
    assert.equal(parseTopics(Array.from({ length: MAX_TOPICS + 1 }, () => crypto.randomUUID()).map((id) => `order:${id}`).join(",")), null);
  });
});

describe("poller de versión (5 s)", () => {
  it("la primera respuesta fija la base; un cambio avisa; tras un error avisa reconexión", async () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      let next: number | Error = 3;
      const p = createVersionPollers({
        fetchVersion: async () => {
          if (next instanceof Error) throw next;
          return next;
        },
        intervalMs: 5000,
      });
      const pings: string[] = [];
      const off = p.subscribe("orders", () => pings.push("ping"), () => pings.push("reconnect"));
      const flush = () => new Promise((r) => setImmediate(r));
      await flush();
      assert.deepEqual(pings, [], "la base no dispara refresco");
      mock.timers.tick(5000);
      await flush();
      assert.deepEqual(pings, []);
      next = 4;
      mock.timers.tick(5000);
      await flush();
      assert.deepEqual(pings, ["ping"]);
      next = new Error("caída");
      mock.timers.tick(5000);
      await flush();
      next = 4;
      mock.timers.tick(5000);
      await flush();
      assert.deepEqual(pings, ["ping", "reconnect"]);
      off();
      assert.equal(p.size(), 0, "sin oyentes se apaga el poller");
    } finally {
      mock.timers.reset();
    }
  });

  it("un solo poller por topic aunque haya varias pantallas", () => {
    mock.timers.enable({ apis: ["setInterval"] });
    try {
      let calls = 0;
      const p = createVersionPollers({ fetchVersion: async () => (calls++, 1), intervalMs: 5000 });
      const a = p.subscribe("orders", () => {}, () => {});
      const b = p.subscribe("orders", () => {}, () => {});
      assert.equal(p.size(), 1);
      assert.equal(calls, 1);
      a();
      assert.equal(p.size(), 1);
      b();
      assert.equal(p.size(), 0);
    } finally {
      mock.timers.reset();
    }
  });
});
