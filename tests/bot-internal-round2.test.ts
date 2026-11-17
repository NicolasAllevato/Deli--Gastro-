import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { handleBot } = await import("../src/lib/bot-internal/handlers.ts");
const { signBotRequest } = await import("../src/lib/bot-internal/signature.ts");
const { cancelOrder, confirmOrder, quoteOrder } = await import("../src/lib/agent/order-actions.ts");
import type { BotResponse } from "../src/lib/bot-internal/handlers.ts";
import type { BotOperation } from "../src/lib/bot-internal/schemas.ts";

// Segunda revisión: cotización fantasma, marca de idempotencia con edad, errores de lectura => 503,
// notas con emojis y negativos del link de pago recuperado.
const T0 = new Date("2026-10-20T15:00:00.000Z");
const SECRET = "secreto-de-prueba-de-al-menos-32-caracteres";
const CONV = "11111111-1111-4111-8111-111111111111";
const NEAR = { label: "Av. Corrientes 1234, CABA", lat: -34.6037, lng: -58.3816 };
const fakeGateway = { createCheckout: async () => ({ id: "pref-1", url: "https://pago.test/abc" }) } as never;
const iso = (offsetSeconds: number) => new Date(T0.getTime() + offsetSeconds * 1000).toISOString();

function newDemo(): DemoDb {
  return createDemoDb((s) => {
    setConfig(s, "horario_apertura", "00:00");
    setConfig(s, "horario_cierre", "23:59");
    setConfig(s, "bot_orders_enabled", true);
    s.wa_conversations.push({
      id: CONV, client_phone: "5491155550101", contact_name: "Sofía", client_id: null, state: {},
      human_takeover: false, last_inbound_at: null, updated_at: T0.toISOString(), created_at: T0.toISOString(),
    });
    for (const [wamid, at] of [["w1", -120], ["w2", -60], ["w3", -30]] as const) {
      s.wa_messages.push({ id: crypto.randomUUID(), conversation_id: CONV, wamid, direction: "in", type: "text", body: "x", status: null, tokens: null, created_at: iso(at) });
    }
  });
}

const productId = (demo: DemoDb) => String(demo.store.products.find((p) => p.name === "Hamburguesa Clásica")!.id);
const stateOf = (demo: DemoDb) => demo.store.wa_conversations[0]!.state as Record<string, unknown>;
const actionDeps = (demo: DemoDb, id: string, extra = {}) => ({
  db: demo.db, conversationId: CONV, messageId: id, dryRun: false, now: () => T0, geocode: async () => [NEAR], gateway: () => fakeGateway, ...extra,
});

async function call(demo: DemoDb, op: BotOperation, body: Record<string, unknown>, opts: { db?: DemoDb["db"]; shift?: number } = {}): Promise<BotResponse> {
  const path = `/api/internal/bot/${op}`;
  const rawBody = JSON.stringify(body);
  const shift = opts.shift ?? 0;
  const timestamp = String(Math.floor(T0.getTime() / 1000) + shift);
  const nonce = crypto.randomUUID();
  const headers = new Map<string, string>([
    ["x-bot-timestamp", timestamp],
    ["x-bot-signature", signBotRequest(SECRET, { timestamp, nonce, method: "POST", path, body: rawBody })],
    ["x-bot-nonce", nonce],
  ]);
  if (typeof body.inboundWamid === "string") headers.set("idempotency-key", body.inboundWamid);
  return handleBot(
    op,
    { method: "POST", path, headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, rawBody, ip: "1.2.3.4" },
    {
      db: opts.db ?? demo.db, secrets: { current: SECRET, previous: "" }, now: () => new Date(T0.getTime() + shift * 1000),
      rateLimit: async () => true, geocode: async () => [NEAR], gateway: () => fakeGateway, log: () => undefined,
    },
  );
}

const quoteBody = (demo: DemoDb) => ({ conversationId: CONV, inboundWamid: "w1", items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
const confirmBody = (wamid = "w2") => ({ conversationId: CONV, inboundWamid: wamid, payment_method: "Mercado Pago" });
const statusBody = { conversationId: CONV, inboundWamid: "w1" };

/** Base que falla una tabla puntual con el error de lectura que devuelve supabase-js. */
function failingTable(demo: DemoDb, table: string, chain: unknown): DemoDb["db"] {
  return { from: (t: string) => (t === table ? chain : demo.db.from(t as never)) } as never;
}
const dbError = { data: null, error: { message: "boom" } };

describe("cotización fantasma (H1)", () => {
  it("si no se puede guardar el borrador, quoteOrder devuelve error y no deja borrador", async () => {
    const demo = newDemo();
    const failing = {
      from: (table: string) => {
        const builder = demo.db.from(table as never) as never as Record<string, (...a: unknown[]) => unknown>;
        if (table !== "wa_conversations") return builder;
        const select = builder.select!.bind(builder);
        builder.select = (cols?: unknown, ...rest: unknown[]) =>
          cols === "state, updated_at" ? { eq: () => ({ maybeSingle: async () => dbError }) } : select(cols, ...rest);
        return builder;
      },
    };
    const out = await quoteOrder(
      actionDeps(demo, "w1", { db: failing }),
      { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" },
    );
    assert.deepEqual(out, { error: "No pude guardar la cotización. Probá de nuevo.", code: "unavailable" });
    assert.equal(stateOf(demo).draft, undefined);
  });

  it("por el endpoint del bot se ve como 503 unavailable", async () => {
    const demo = newDemo();
    const failing = {
      from: (table: string) => {
        const builder = demo.db.from(table as never) as never as Record<string, (...a: unknown[]) => unknown>;
        if (table !== "wa_conversations") return builder;
        const select = builder.select!.bind(builder);
        builder.select = (cols?: unknown, ...rest: unknown[]) =>
          cols === "state, updated_at" ? { eq: () => ({ maybeSingle: async () => dbError }) } : select(cols, ...rest);
        return builder;
      },
    };
    const res = await call(demo, "quote", quoteBody(demo), { db: failing as never });
    assert.deepEqual([res.status, res.body.code], [503, "unavailable"]);
  });
});

describe("errores de lectura => 503 (H4, H5)", () => {
  it("global_config ilegible: todas las operaciones responden 503", async () => {
    const demo = newDemo();
    const db = failingTable(demo, "global_config", { select: async () => dbError });
    for (const [op, body] of [
      ["quote", quoteBody(demo)], ["confirm", confirmBody()], ["status", statusBody],
      ["cancel", { conversationId: CONV, inboundWamid: "w3", confirmed: true }],
    ] as const) {
      const res = await call(demo, op, body, { db });
      assert.deepEqual([res.status, res.body.code], [503, "unavailable"], op);
    }
  });

  it("wa_messages con error de base: 503, no 403 ni 409", async () => {
    const demo = newDemo();
    const db = failingTable(demo, "wa_messages", { select: () => ({ eq: () => ({ eq: () => ({ limit: async () => dbError }) }) }) });
    const res = await call(demo, "status", statusBody, { db });
    assert.deepEqual([res.status, res.body.code], [503, "unavailable"]);
  });

  it("un wamid que no existe sigue siendo 403 (no confundir con error de base)", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "status", { ...statusBody, inboundWamid: "nada" })).status, 403);
  });
});

describe("edad de la marca de idempotencia (H2)", () => {
  it("la marca guarda 'at' y se descarta pasados 30 minutos", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    assert.equal((await call(demo, "confirm", confirmBody())).status, 200);
    const mark = (stateOf(demo).botIdem as { confirm: { at?: string } }).confirm;
    assert.equal(mark.at, T0.toISOString());
    // A los 20 min se reproduce; a los 32 min ya no (y el wamid además venció: 403).
    assert.equal((await call(demo, "confirm", confirmBody(), { shift: 1200 })).body.replayed, true);
    assert.equal((await call(demo, "confirm", confirmBody(), { shift: 1920 })).status, 403);
  });

  it("una marca sin 'at' (formato viejo) no se reproduce", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    await call(demo, "confirm", confirmBody());
    delete (stateOf(demo).botIdem as { confirm: { at?: string } }).confirm.at;
    assert.equal((await call(demo, "confirm", confirmBody(), { shift: 1200 })).status, 403);
  });

  it("el replay no respeta bot_orders_enabled (es la respuesta ya calculada)", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    await call(demo, "confirm", confirmBody());
    setConfig(demo.store, "bot_orders_enabled", false);
    assert.equal((await call(demo, "confirm", confirmBody())).body.replayed, true);
  });
});

describe("notas (H6)", () => {
  it("la tabulación pasa a espacio y los emojis compuestos no se rompen", async () => {
    const { cleanNotes } = await import("../src/lib/bot-internal/schemas.ts");
    assert.equal(cleanNotes("sin\tcebolla"), "sin cebolla");
    const family = "👨‍👩‍👧";
    const heart = "❤️";
    assert.equal(cleanNotes(`${family} ${heart}`), `${family} ${heart}`);
    assert.equal(cleanNotes("a​b\u0000c"), "abc");
  });
});

describe("order-actions: hooks (H7a, H7b, H7c)", () => {
  it("checkDraft ve el borrador releído, no el de antes", async () => {
    const demo = newDemo();
    await quoteOrder(actionDeps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    // Otro proceso cambia el borrador entre la cotización y la confirmación.
    (stateOf(demo).draft as { address: string }).address = "Dirección cambiada 99";
    let seen = "";
    await confirmOrder(
      actionDeps(demo, "w2", { checkDraft: (d: { address: string }) => { seen = d.address; return { error: "x", code: "limit_exceeded" as const }; } }),
      { payment_method: "Mercado Pago" },
    );
    assert.equal(seen, "Dirección cambiada 99");
  });

  it("un checkDraft asíncrono que rechaza corta antes del claim", async () => {
    const demo = newDemo();
    await quoteOrder(actionDeps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    const out = await confirmOrder(
      actionDeps(demo, "w2", { checkDraft: async () => ({ error: "tope async", code: "limit_exceeded" as const }) }),
      { payment_method: "Mercado Pago" },
    );
    assert.deepEqual(out, { error: "tope async", code: "limit_exceeded" });
    assert.ok(stateOf(demo).draft, "no se reclamó");
    assert.equal(demo.store.payment_intents.length, 0);
  });

  it("cancel sin pedido: error sin código (409 'rejected' en el endpoint)", async () => {
    const demo = newDemo();
    assert.deepEqual(await cancelOrder(actionDeps(demo, "w3")), { error: "No encontré un pedido para cancelar." });
    const res = await call(demo, "cancel", { conversationId: CONV, inboundWamid: "w3", confirmed: true });
    assert.deepEqual([res.status, res.body.code], [409, "rejected"]);
  });
});

describe("link de pago recuperado: negativos (H7d)", () => {
  /** Deja un confirm exitoso, sin marca de idempotencia, y devuelve el borrador que había. */
  async function confirmedWithoutMark(demo: DemoDb) {
    await call(demo, "quote", quoteBody(demo));
    const draft = structuredClone(stateOf(demo).draft);
    assert.equal((await call(demo, "confirm", confirmBody())).status, 200);
    delete stateOf(demo).botIdem;
    return draft;
  }

  it("intención de otro cliente: no devuelve el link", async () => {
    const demo = newDemo();
    await confirmedWithoutMark(demo);
    demo.store.payment_intents[0]!.client_id = crypto.randomUUID();
    const res = await call(demo, "confirm", confirmBody("w3"));
    assert.equal(res.body.replayed, undefined);
    assert.deepEqual([res.status, res.body.code], [409, "no_draft"]);
  });

  it("intención vencida: no devuelve el link", async () => {
    const demo = newDemo();
    await confirmedWithoutMark(demo);
    demo.store.payment_intents[0]!.expires_at = iso(-10);
    const res = await call(demo, "confirm", confirmBody("w3"));
    assert.equal(res.body.replayed, undefined);
    assert.deepEqual([res.status, res.body.code], [409, "no_draft"]);
  });

  it("intención de canal web: no se reutiliza (y sigue contando como pedido en curso)", async () => {
    const demo = newDemo();
    await confirmedWithoutMark(demo);
    (demo.store.payment_intents[0] as { channel: string }).channel = "web";
    const res = await call(demo, "confirm", confirmBody("w3"));
    assert.equal(res.body.replayed, undefined);
    assert.equal(res.body.payment_url, undefined);
    assert.deepEqual([res.status, res.body.code], [422, "limit_exceeded"]);
  });

  it("con borrador presente no devuelve el link viejo", async () => {
    const demo = newDemo();
    const draft = await confirmedWithoutMark(demo);
    stateOf(demo).draft = draft;
    const res = await call(demo, "confirm", confirmBody("w3"));
    assert.equal(res.body.replayed, undefined);
    assert.equal(res.body.payment_url, undefined);
    assert.equal(demo.store.payment_intents.length, 1);
  });
});

describe("readLimited (H7e)", () => {
  it("cancela el stream al pasar el tope", async () => {
    const { readLimited } = await import("../src/lib/bot-internal/read-body.ts");
    let cancelled = false;
    const body = new ReadableStream({
      pull(controller) { controller.enqueue(new TextEncoder().encode("a".repeat(10))); },
      cancel() { cancelled = true; },
    });
    assert.equal(await readLimited({ body } as unknown as Request, 25), null);
    assert.equal(cancelled, true);
  });

  it("un carácter UTF-8 partido entre chunks se arma bien", async () => {
    const { readLimited } = await import("../src/lib/bot-internal/read-body.ts");
    const bytes = new TextEncoder().encode("niño 👍");
    const body = new ReadableStream({
      start(controller) {
        for (const b of bytes) controller.enqueue(new Uint8Array([b]));
        controller.close();
      },
    });
    assert.equal(await readLimited({ body } as unknown as Request, 100), "niño 👍");
  });
});
