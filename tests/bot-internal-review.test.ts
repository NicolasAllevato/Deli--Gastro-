import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { handleBot } = await import("../src/lib/bot-internal/handlers.ts");
const { signBotRequest, verifyBotRequest } = await import("../src/lib/bot-internal/signature.ts");
const { confirmOrder, quoteOrder } = await import("../src/lib/agent/order-actions.ts");
import type { BotDeps, BotResponse } from "../src/lib/bot-internal/handlers.ts";
import type { BotOperation } from "../src/lib/bot-internal/schemas.ts";

// Revisión posterior al PR 2: allowlist fail-closed, link perdido, topes sobre el borrador real,
// human_takeover, pedidos activos, replay antes de frescura, idempotencia sin pisar y endurecimientos bajos.
const T0 = new Date("2026-10-20T15:00:00.000Z");
const SECRET = "secreto-de-prueba-de-al-menos-32-caracteres";
const CONV = "11111111-1111-4111-8111-111111111111";
const PHONE = "5491155550101";
const NEAR = { label: "Av. Corrientes 1234, CABA", lat: -34.6037, lng: -58.3816 };
const fakeGateway = { createCheckout: async () => ({ id: "pref-1", url: "https://pago.test/abc" }) } as never;
const iso = (offsetSeconds: number) => new Date(T0.getTime() + offsetSeconds * 1000).toISOString();

function newDemo(mutate?: (s: DemoDb["store"]) => void): DemoDb {
  return createDemoDb((s) => {
    setConfig(s, "horario_apertura", "00:00");
    setConfig(s, "horario_cierre", "23:59");
    setConfig(s, "bot_orders_enabled", true);
    s.wa_conversations.push({
      id: CONV, client_phone: PHONE, contact_name: "Sofía", client_id: null, state: {},
      human_takeover: false, last_inbound_at: null, updated_at: T0.toISOString(), created_at: T0.toISOString(),
    });
    const msg = (wamid: string, direction: string, at: number) =>
      s.wa_messages.push({ id: crypto.randomUUID(), conversation_id: CONV, wamid, direction, type: "text", body: "x", status: null, tokens: null, created_at: iso(at) });
    msg("w1", "in", -120);
    msg("w2", "in", -60);
    msg("w3", "in", -30);
    msg("out1", "out", -50);
    mutate?.(s);
  });
}

const productId = (demo: DemoDb) => String(demo.store.products.find((p) => p.name === "Hamburguesa Clásica")!.id);
const draftOf = (demo: DemoDb) => (demo.store.wa_conversations[0]!.state as { draft?: unknown }).draft;

interface CallOptions {
  secret?: string;
  secrets?: BotDeps["secrets"];
  db?: DemoDb["db"];
  nowShiftSec?: number;
}

async function call(demo: DemoDb, op: BotOperation, body: Record<string, unknown>, opts: CallOptions = {}): Promise<BotResponse> {
  const path = `/api/internal/bot/${op}`;
  const rawBody = JSON.stringify(body);
  const shift = opts.nowShiftSec ?? 0;
  const timestamp = String(Math.floor(T0.getTime() / 1000) + shift);
  const signature = signBotRequest(opts.secret ?? SECRET, { timestamp, method: "POST", path, body: rawBody });
  const headers = new Map<string, string>([["x-bot-timestamp", timestamp], ["x-bot-signature", signature]]);
  if (typeof body.inboundWamid === "string") headers.set("idempotency-key", body.inboundWamid);
  return handleBot(
    op,
    { method: "POST", path, headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, rawBody, ip: "1.2.3.4" },
    {
      db: opts.db ?? demo.db,
      secrets: opts.secrets ?? { current: SECRET, previous: "" },
      now: () => new Date(T0.getTime() + shift * 1000),
      rateLimit: async () => true,
      geocode: async () => [NEAR],
      gateway: () => fakeGateway,
      log: () => undefined,
    },
  );
}

const quoteBody = (demo: DemoDb, extra: Record<string, unknown> = {}) => ({
  conversationId: CONV, inboundWamid: "w1", items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234", ...extra,
});
const confirmBody = (extra: Record<string, unknown> = {}) => ({ conversationId: CONV, inboundWamid: "w2", payment_method: "Mercado Pago", ...extra });
const statusBody = { conversationId: CONV, inboundWamid: "w1" };
const cancelBody = { conversationId: CONV, inboundWamid: "w3", confirmed: true };
const actionDeps = (demo: DemoDb, id: string, extra = {}) => ({
  db: demo.db, conversationId: CONV, messageId: id, dryRun: false, now: () => T0, geocode: async () => [NEAR], gateway: () => fakeGateway, ...extra,
});

describe("allowlist fail-closed", () => {
  const bad: unknown[] = [{}, 5, "abc", [""], ["abc"], [{}], [null], true, false, { phones: ["1"] }, ["--"]];

  it("un valor definido que no da ningún teléfono bloquea a todos (quote, confirm, status y cancel)", async () => {
    for (const value of bad) {
      const demo = newDemo((s) => setConfig(s, "bot_orders_allowlist", value));
      const label = JSON.stringify(value);
      assert.equal((await call(demo, "quote", quoteBody(demo))).status, 403, label);
      assert.equal((await call(demo, "confirm", confirmBody())).status, 403, label);
      const status = await call(demo, "status", statusBody);
      assert.deepEqual([status.status, status.body.code], [403, "orders_disabled"], label);
      assert.equal((await call(demo, "cancel", cancelBody)).status, 403, label);
    }
  });

  it("ausente, [] o texto vacío = sin restricción; '*' = todos", async () => {
    for (const value of [undefined, null, [], "", "  ", "*", ["*"], ["+54 9 11 6000-0000", "*"]]) {
      const demo = newDemo((s) => { if (value !== undefined) setConfig(s, "bot_orders_allowlist", value); });
      assert.equal((await call(demo, "quote", quoteBody(demo))).status, 200, JSON.stringify(value));
    }
  });

  it("status y cancel siguen la allowlist pero NO el flag de pedidos apagado", async () => {
    const mine = newDemo((s) => { setConfig(s, "bot_orders_enabled", false); setConfig(s, "bot_orders_allowlist", [PHONE]); });
    assert.equal((await call(mine, "status", statusBody)).status, 200);
    const other = newDemo((s) => { setConfig(s, "bot_orders_enabled", false); setConfig(s, "bot_orders_allowlist", ["5491100009999"]); });
    assert.equal((await call(other, "status", statusBody)).status, 403);
  });
});

describe("confirm exitoso y link perdido", () => {
  it("si se pierde la marca de idempotencia, un reintento con otro wamid recibe el mismo link", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    assert.equal((await call(demo, "confirm", confirmBody())).status, 200);
    delete (demo.store.wa_conversations[0]!.state as Record<string, unknown>).botIdem;

    const again = await call(demo, "confirm", confirmBody({ inboundWamid: "w3" }));
    assert.equal(again.status, 200);
    assert.deepEqual([again.body.awaiting_payment, again.body.replayed, again.body.payment_url], [true, true, "https://pago.test/abc"]);
    assert.equal(demo.store.payment_intents.length, 1);
  });

  it("un fallo al guardar la marca no tira abajo un confirm ya exitoso", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    const failing = {
      from: (table: string) => {
        const builder = demo.db.from(table as never) as never as Record<string, (...a: unknown[]) => unknown>;
        if (table !== "wa_conversations") return builder;
        const select = builder.select!.bind(builder);
        builder.select = (cols?: unknown, ...rest: unknown[]) => {
          if (cols === "state, updated_at") throw new Error("base caída");
          return select(cols, ...rest);
        };
        return builder;
      },
    };
    const res = await call(demo, "confirm", confirmBody(), { db: failing as never });
    assert.equal(res.status, 200);
    assert.equal(res.body.awaiting_payment, true);
    assert.equal(demo.store.payment_intents.length, 1);
  });
});

describe("topes sobre el borrador real", () => {
  it("checkDraft se evalúa sobre el borrador releído y antes del claim", async () => {
    const demo = newDemo();
    await quoteOrder(actionDeps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 2 }], address: "Av. Corrientes 1234" });
    let seen: unknown = null;
    const out = await confirmOrder(
      actionDeps(demo, "w2", { checkDraft: (d: unknown) => { seen = d; return { error: "tope", code: "limit_exceeded" as const }; } }),
      { payment_method: "Mercado Pago" },
    );
    assert.equal((out as { code?: string }).code, "limit_exceeded");
    assert.deepEqual((seen as { items: unknown[] }).items, (draftOf(demo) as { items: unknown[] }).items);
    assert.equal(demo.store.payment_intents.length, 0);
    assert.ok(draftOf(demo), "no se reclamó");
  });

  it("checkQuote rechaza antes de guardar el borrador", async () => {
    const demo = newDemo();
    const out = await quoteOrder(
      actionDeps(demo, "w1", { checkQuote: () => ({ error: "tope", code: "limit_exceeded" as const }) }),
      { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" },
    );
    assert.equal((out as { code?: string }).code, "limit_exceeded");
    assert.equal(draftOf(demo), undefined);
  });

  it("en confirm, un borrador que quedó sobre el tope se rechaza (422) y no se reclama", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    setConfig(demo.store, "bot_max_total", 100);
    const res = await call(demo, "confirm", confirmBody());
    assert.deepEqual([res.status, res.body.code], [422, "limit_exceeded"]);
    assert.ok(draftOf(demo));
    assert.equal(demo.store.payment_intents.length, 0);
  });
});

describe("human_takeover y pedidos activos", () => {
  async function withCashOrder(): Promise<DemoDb> {
    const demo = newDemo();
    await quoteOrder(actionDeps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    await confirmOrder(actionDeps(demo, "w2"), { payment_method: "Efectivo" });
    return demo;
  }

  it("human_takeover bloquea quote y confirm (409) pero no status ni cancel", async () => {
    const demo = newDemo();
    demo.store.wa_conversations[0]!.human_takeover = true;
    for (const [op, body] of [["quote", quoteBody(demo)], ["confirm", confirmBody()]] as const) {
      const res = await call(demo, op, body);
      assert.deepEqual([res.status, res.body.code], [409, "human_takeover"]);
    }
    assert.equal((await call(demo, "status", statusBody)).status, 200);
    assert.notEqual((await call(demo, "cancel", cancelBody)).body.code, "human_takeover");
  });

  it("un pedido activo más viejo que bot_active_window_hours no bloquea", async () => {
    const demo = await withCashOrder();
    const order = demo.store.orders.at(-1)!;
    order.created_at = iso(-4 * 3600);
    assert.equal((await call(demo, "quote", quoteBody(demo, { inboundWamid: "w3" }))).status, 200);
    order.created_at = iso(-60);
    assert.equal((await call(demo, "quote", quoteBody(demo, { inboundWamid: "w3" }))).status, 422);
    setConfig(demo.store, "bot_active_window_hours", 0.01);
    assert.equal((await call(demo, "quote", quoteBody(demo, { inboundWamid: "w3" }))).status, 200);
  });

  it("si falla la consulta de pedidos activos responde 503 unavailable (no cuenta 0)", async () => {
    const demo = await withCashOrder();
    const broken = {
      from: (table: string) =>
        table === "orders"
          ? { select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "boom" } }) }) }) }
          : demo.db.from(table as never),
    };
    const res = await call(demo, "quote", quoteBody(demo, { inboundWamid: "w3" }), { db: broken as never });
    assert.deepEqual([res.status, res.body.code], [503, "unavailable"]);
    assert.equal((await call(demo, "confirm", confirmBody({ inboundWamid: "w3" }), { db: broken as never })).status, 503);
  });
});

describe("replay antes de frescura e idempotencia sin pisar", () => {
  it("un reintento demorado (>10 min) de un confirm ya hecho devuelve la respuesta guardada", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    const first = await call(demo, "confirm", confirmBody());
    const late = await call(demo, "confirm", confirmBody(), { nowShiftSec: 1200 });
    assert.equal(late.status, 200);
    assert.equal(late.body.replayed, true);
    assert.equal(late.body.payment_url, first.body.payment_url);
    // Sin marca guardada, un wamid viejo sigue siendo 403.
    assert.equal((await call(demo, "confirm", confirmBody({ inboundWamid: "w3" }), { nowShiftSec: 1200 })).status, 403);
  });

  it("el replay no salta la verificación de pertenencia del wamid", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    await call(demo, "confirm", confirmBody());
    assert.equal((await call(demo, "confirm", confirmBody({ inboundWamid: "out1" }))).status, 403);
  });

  it("updateConversationState reintenta una vez si otro escribió en el medio y no lanza si sigue fallando", async () => {
    const { updateConversationState } = await import("../src/lib/agent/conversation-state.ts");
    const demo = newDemo();
    let bumps = 0;
    const once = await updateConversationState(demo.db, CONV, (state) => {
      if (bumps++ < 1) demo.store.wa_conversations[0]!.updated_at = iso(10);
      return { ...(state as object), marca: 1 };
    });
    assert.equal(once, true);
    assert.equal((demo.store.wa_conversations[0]!.state as { marca?: number }).marca, 1);

    let n = 0;
    const never = await updateConversationState(demo.db, CONV, (state) => {
      demo.store.wa_conversations[0]!.updated_at = iso(20 + n++);
      return { ...(state as object), marca: 2 };
    });
    assert.equal(never, false);
    assert.equal((demo.store.wa_conversations[0]!.state as { marca?: number }).marca, 1);
  });
});

describe("endurecimientos bajos", () => {
  it("secreto de menos de 32 caracteres = 503 como ausente; PREV corto se ignora", async () => {
    const demo = newDemo();
    const short = "corto";
    assert.equal((await call(demo, "quote", quoteBody(demo), { secret: short, secrets: { current: short, previous: "" } })).status, 503);
    assert.equal((await call(demo, "quote", quoteBody(demo), { secret: short, secrets: { current: SECRET, previous: short } })).status, 401);
  });

  it("la firma debe medir exactamente 64 hex", () => {
    const sig = signBotRequest(SECRET, { timestamp: "1000", method: "POST", path: "/p", body: "{}" });
    const base = { secrets: [SECRET], method: "POST", path: "/p", body: "{}", timestamp: "1000", nowMs: 1_000_000 };
    assert.equal(sig.length, 64);
    assert.equal(verifyBotRequest({ ...base, signature: sig }).ok, true);
    assert.equal(verifyBotRequest({ ...base, signature: sig + "00" }).ok, false);
    assert.equal(verifyBotRequest({ ...base, signature: sig.slice(0, 62) }).ok, false);
  });

  it("product_id debe ser uuid y notes se limpian", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "quote", quoteBody(demo, { items: [{ product_id: "no-uuid", qty: 1 }] }))).status, 400);

    const { cleanNotes } = await import("../src/lib/bot-internal/schemas.ts");
    assert.equal(cleanNotes("sin\u0000 cebolla\u0007​\r\n\r\n\r\n\r\ntimbre"), "sin cebolla\n\ntimbre");
    assert.equal(cleanNotes("a\nb"), "a\nb");

    await call(demo, "quote", quoteBody(demo));
    assert.equal((await call(demo, "confirm", confirmBody({ notes: "sin\u0000 cebolla" }))).status, 200);
  });

  it("readLimited corta al pasar el tope aunque no haya Content-Length", async () => {
    const { readLimited } = await import("../src/lib/bot-internal/read-body.ts");
    const streamOf = (chunks: string[]) =>
      ({ body: new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } }) }) as unknown as Request;
    assert.equal(await readLimited(streamOf(["hola ", "mundo"]), 100), "hola mundo");
    assert.equal(await readLimited(streamOf(["a".repeat(10), "b".repeat(10)]), 15), null);
    assert.equal(await readLimited({ body: null } as unknown as Request, 10), "");
  });

  it("el default de bot_max_total es 80000", async () => {
    const { DEFAULT_MAX_TOTAL } = await import("../src/lib/bot-internal/handlers.ts");
    assert.equal(DEFAULT_MAX_TOTAL, 80_000);
  });
});
