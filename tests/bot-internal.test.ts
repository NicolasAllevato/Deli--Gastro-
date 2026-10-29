import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDemoDb, setConfig, type DemoDb } from "./helpers/demo-db.ts";

const { handleBot } = await import("../src/lib/bot-internal/handlers.ts");
const { signBotRequest, verifyBotRequest, SIGNATURE_WINDOW_SECONDS } = await import("../src/lib/bot-internal/signature.ts");
const { confirmOrder, quoteOrder, reloadConversation, isActionError } = await import("../src/lib/agent/order-actions.ts");
import type { BotDeps, BotResponse } from "../src/lib/bot-internal/handlers.ts";
import type { BotOperation } from "../src/lib/bot-internal/schemas.ts";

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
    msg("old", "in", -11 * 60);
    mutate?.(s);
  });
}

const productId = (demo: DemoDb, name = "Hamburguesa Clásica") => String(demo.store.products.find((p) => p.name === name)!.id);
const draftOf = (demo: DemoDb) => (demo.store.wa_conversations[0]!.state as { draft?: unknown }).draft;

interface CallOptions {
  secret?: string;
  tsOffset?: number;
  key?: string | null;
  method?: string;
  signPath?: string;
  rateLimit?: BotDeps["rateLimit"];
  secrets?: BotDeps["secrets"];
  rawBody?: string;
  db?: DemoDb["db"];
  nowShiftSec?: number;
}

async function call(demo: DemoDb, op: BotOperation, body: Record<string, unknown>, opts: CallOptions = {}): Promise<BotResponse> {
  const path = `/api/internal/bot/${op}`;
  const rawBody = opts.rawBody ?? JSON.stringify(body);
  const shift = opts.nowShiftSec ?? 0;
  const timestamp = String(Math.floor(T0.getTime() / 1000) + shift + (opts.tsOffset ?? 0));
  const signature = signBotRequest(opts.secret ?? SECRET, { timestamp, method: opts.method ?? "POST", path: opts.signPath ?? path, body: rawBody });
  const headers = new Map<string, string>([["x-bot-timestamp", timestamp], ["x-bot-signature", signature]]);
  const wamid = body.inboundWamid;
  const key = opts.key === undefined ? (typeof wamid === "string" ? wamid : null) : opts.key;
  if (key) headers.set("idempotency-key", key);
  return handleBot(
    op,
    { method: "POST", path, headers: { get: (n) => headers.get(n.toLowerCase()) ?? null }, rawBody, ip: "1.2.3.4" },
    {
      db: opts.db ?? demo.db,
      secrets: opts.secrets ?? { current: SECRET, previous: "" },
      now: () => new Date(T0.getTime() + shift * 1000),
      rateLimit: opts.rateLimit ?? (async () => true),
      geocode: async () => [NEAR],
      gateway: () => fakeGateway,
      log: () => undefined,
    },
  );
}

const quoteBody = (demo: DemoDb, extra: Record<string, unknown> = {}) => ({
  conversationId: CONV,
  inboundWamid: "w1",
  items: [{ product_id: productId(demo), qty: 1 }],
  address: "Av. Corrientes 1234",
  ...extra,
});
const confirmBody = (extra: Record<string, unknown> = {}) => ({
  conversationId: CONV, inboundWamid: "w2", payment_method: "Mercado Pago", ...extra,
});

describe("firma", () => {
  const parts = { timestamp: "1000", method: "POST", path: "/api/internal/bot/quote", body: "{}" };
  const base = { secrets: [SECRET], method: "POST", path: parts.path, body: "{}", timestamp: "1000", nowMs: 1_000_000 };
  const sig = signBotRequest(SECRET, parts);

  it("acepta una firma válida y rechaza una inválida", () => {
    assert.deepEqual(verifyBotRequest({ ...base, signature: sig }), { ok: true });
    assert.deepEqual(verifyBotRequest({ ...base, signature: "00".repeat(32) }), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyBotRequest({ ...base, signature: "zz" }), { ok: false, reason: "bad_signature" });
    assert.deepEqual(verifyBotRequest({ ...base, signature: sig.slice(0, 10) }), { ok: false, reason: "bad_signature" });
    assert.equal(verifyBotRequest({ ...base, signature: null }).ok, false);
  });

  it("rechaza firmas viejas (>60 s) y futuras, y acepta el borde de la ventana", () => {
    assert.deepEqual(verifyBotRequest({ ...base, signature: sig, nowMs: (1000 + SIGNATURE_WINDOW_SECONDS + 1) * 1000 }), { ok: false, reason: "stale" });
    assert.deepEqual(verifyBotRequest({ ...base, signature: sig, nowMs: (1000 - SIGNATURE_WINDOW_SECONDS - 1) * 1000 }), { ok: false, reason: "future" });
    assert.equal(verifyBotRequest({ ...base, signature: sig, nowMs: (1000 + SIGNATURE_WINDOW_SECONDS) * 1000 }).ok, true);
  });

  it("la firma depende del método, del path y del cuerpo", () => {
    assert.equal(verifyBotRequest({ ...base, signature: sig, method: "GET" }).ok, false);
    assert.equal(verifyBotRequest({ ...base, signature: sig, path: "/api/internal/bot/confirm" }).ok, false);
    assert.equal(verifyBotRequest({ ...base, signature: sig, body: '{"a":1}' }).ok, false);
  });

  it("acepta el secreto anterior durante la rotación", () => {
    const prev = signBotRequest("secreto-viejo-de-al-menos-32-caracteres", parts);
    assert.equal(verifyBotRequest({ ...base, secrets: [SECRET, "secreto-viejo-de-al-menos-32-caracteres"], signature: prev }).ok, true);
    assert.equal(verifyBotRequest({ ...base, secrets: [SECRET], signature: prev }).ok, false);
    assert.equal(verifyBotRequest({ ...base, secrets: ["", ""], signature: sig }).ok, false);
  });
});

describe("autenticación del endpoint", () => {
  it("firma inválida, vieja, futura o de otro path/método: 401", async () => {
    const demo = newDemo();
    const body = quoteBody(demo);
    assert.equal((await call(demo, "quote", body, { secret: "otro" })).status, 401);
    assert.equal((await call(demo, "quote", body, { tsOffset: -120 })).status, 401);
    assert.equal((await call(demo, "quote", body, { tsOffset: 120 })).status, 401);
    assert.equal((await call(demo, "quote", body, { signPath: "/api/internal/bot/confirm" })).status, 401);
    assert.equal((await call(demo, "quote", body, { method: "GET" })).status, 401);
    assert.equal(draftOf(demo), undefined);
  });

  it("sin BOT_INTERNAL_SECRET responde 503 (corte de emergencia)", async () => {
    const demo = newDemo();
    const res = await call(demo, "quote", quoteBody(demo), { secrets: { current: "", previous: "" } });
    assert.equal(res.status, 503);
    // Aun con el anterior definido, sin el vigente no hay servicio.
    assert.equal((await call(demo, "quote", quoteBody(demo), { secrets: { current: "", previous: SECRET } })).status, 503);
  });

  it("acepta el secreto anterior", async () => {
    const demo = newDemo();
    const res = await call(demo, "quote", quoteBody(demo), { secret: "secreto-viejo-de-al-menos-32-caracteres", secrets: { current: SECRET, previous: "secreto-viejo-de-al-menos-32-caracteres" } });
    assert.equal(res.status, 200);
  });

  it("cuerpo demasiado grande: 413", async () => {
    const demo = newDemo();
    const res = await call(demo, "quote", {}, { rawBody: JSON.stringify({ x: "a".repeat(17 * 1024) }) });
    assert.equal(res.status, 413);
  });

  it("rate limit por IP y por conversación: 429", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "status", { conversationId: CONV, inboundWamid: "w1" }, { rateLimit: async () => false })).status, 429);
    const onlyConv: BotDeps["rateLimit"] = async (key) => !key.startsWith("bot-conv:");
    const res = await call(demo, "status", { conversationId: CONV, inboundWamid: "w1" }, { rateLimit: onlyConv });
    assert.equal(res.status, 429);
  });
});

describe("validación (zod)", () => {
  it("rechaza topes y campos de más", async () => {
    const demo = newDemo();
    const pid = productId(demo);
    const cases: Array<Record<string, unknown>> = [
      quoteBody(demo, { items: [{ product_id: pid, qty: 0 }] }),
      quoteBody(demo, { items: [{ product_id: pid, qty: 21 }] }),
      quoteBody(demo, { items: [{ product_id: pid, qty: 1.5 }] }),
      quoteBody(demo, { items: [] }),
      quoteBody(demo, { items: Array.from({ length: 31 }, () => ({ product_id: pid, qty: 1 })) }),
      quoteBody(demo, { address: "abcd" }),
      quoteBody(demo, { address: "a".repeat(201) }),
      quoteBody(demo, { clientId: "x" }),
      quoteBody(demo, { total: 1 }),
      quoteBody(demo, { items: [{ product_id: pid, qty: 1, price: 1 }] }),
    ];
    for (const body of cases) {
      const res = await call(demo, "quote", body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 80));
      assert.equal(res.body.code, "invalid_body");
    }
    assert.equal((await call(demo, "confirm", confirmBody({ notes: "n".repeat(301) }))).status, 400);
    assert.equal((await call(demo, "confirm", confirmBody({ rewardId: "r1" }))).status, 400);
    assert.equal((await call(demo, "quote", {}, { rawBody: "no es json" })).status, 400);
  });
});

describe("verificación del wamid", () => {
  it("wamid ajeno, saliente, viejo o inexistente: 403 y no se escribe nada", async () => {
    const demo = newDemo((s) => {
      s.wa_conversations.push({
        id: "22222222-2222-4222-8222-222222222222", client_phone: "5491100000000", contact_name: null, client_id: null, state: {},
        human_takeover: false, last_inbound_at: null, updated_at: T0.toISOString(), created_at: T0.toISOString(),
      });
      s.wa_messages.push({ id: crypto.randomUUID(), conversation_id: "22222222-2222-4222-8222-222222222222", wamid: "ajeno", direction: "in", type: "text", body: "x", status: null, tokens: null, created_at: iso(-10) });
    });
    for (const wamid of ["ajeno", "out1", "old", "no-existe"]) {
      const res = await call(demo, "quote", quoteBody(demo, { inboundWamid: wamid }));
      assert.equal(res.status, 403, wamid);
      assert.equal(res.body.code, "forbidden");
    }
    assert.equal(draftOf(demo), undefined);
  });

  it("conversación inexistente: 404", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "status", { conversationId: "nope", inboundWamid: "w1" })).status, 404);
  });
});

describe("interruptores", () => {
  it("bot_orders_enabled apagado (o ausente): quote y confirm 403; status y cancel siguen", async () => {
    const demo = newDemo((s) => setConfig(s, "bot_orders_enabled", false));
    const q = await call(demo, "quote", quoteBody(demo));
    assert.deepEqual([q.status, q.body.code], [403, "orders_disabled"]);
    assert.deepEqual([(await call(demo, "confirm", confirmBody())).status], [403]);
    assert.equal((await call(demo, "status", { conversationId: CONV, inboundWamid: "w1" })).status, 200);
    const c = await call(demo, "cancel", { conversationId: CONV, inboundWamid: "w1", confirmed: true });
    assert.notEqual(c.status, 403);

    const absent = newDemo((s) => { s.global_config = s.global_config.filter((r) => r.key !== "bot_orders_enabled"); });
    assert.equal((await call(absent, "quote", quoteBody(absent))).status, 403);
  });

  it("allowlist: solo los teléfonos de la lista pueden cotizar", async () => {
    const outside = newDemo((s) => setConfig(s, "bot_orders_allowlist", ["+54 9 11 6000-0000"]));
    assert.equal((await call(outside, "quote", quoteBody(outside))).status, 403);
    const inside = newDemo((s) => setConfig(s, "bot_orders_allowlist", ["+54 9 11 5555-0101"]));
    assert.equal((await call(inside, "quote", quoteBody(inside))).status, 200);
    const empty = newDemo((s) => setConfig(s, "bot_orders_allowlist", []));
    assert.equal((await call(empty, "quote", quoteBody(empty))).status, 200);
  });

  it("los interruptores se leen en cada llamada (sin caché)", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "quote", quoteBody(demo))).status, 200);
    setConfig(demo.store, "bot_orders_enabled", false);
    assert.equal((await call(demo, "quote", quoteBody(demo))).status, 403);
  });
});

describe("topes y reglas de la v1", () => {
  it("unidades totales: 422 limit_exceeded", async () => {
    const demo = newDemo();
    const res = await call(demo, "quote", quoteBody(demo, { items: [{ product_id: productId(demo), qty: 13 }] }));
    assert.deepEqual([res.status, res.body.code], [422, "limit_exceeded"]);
    setConfig(demo.store, "bot_max_units", 20);
    setConfig(demo.store, "bot_max_total", 500000);
    assert.equal((await call(demo, "quote", quoteBody(demo, { items: [{ product_id: productId(demo), qty: 13 }] }))).status, 200);
  });

  it("importe máximo: 422 y no deja un borrador confirmable", async () => {
    const demo = newDemo((s) => setConfig(s, "bot_max_total", 5000));
    const res = await call(demo, "quote", quoteBody(demo));
    assert.deepEqual([res.status, res.body.code], [422, "limit_exceeded"]);
    assert.equal(draftOf(demo), undefined);
  });

  it("importe máximo también en confirm (si el tope bajó tras cotizar)", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "quote", quoteBody(demo))).status, 200);
    setConfig(demo.store, "bot_max_total", 5000);
    const res = await call(demo, "confirm", confirmBody());
    assert.deepEqual([res.status, res.body.code], [422, "limit_exceeded"]);
    assert.equal(demo.store.payment_intents.length, 0);
  });

  it("pedidos activos: con uno en curso no cotiza otro", async () => {
    const demo = newDemo();
    const cash = (id: string) => ({ db: demo.db, conversationId: CONV, messageId: id, dryRun: false, now: () => T0, geocode: async () => [NEAR], gateway: () => fakeGateway });
    await quoteOrder(cash("w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    const made = await confirmOrder(cash("w2"), { payment_method: "Efectivo" });
    assert.equal("order_code" in made, true);
    const res = await call(demo, "quote", quoteBody(demo, { inboundWamid: "w3" }));
    assert.deepEqual([res.status, res.body.code], [422, "limit_exceeded"]);
  });

  it("confirm solo acepta Mercado Pago", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    for (const method of ["Efectivo", "Tarjeta", "Transferencia"]) {
      const res = await call(demo, "confirm", confirmBody({ payment_method: method }));
      assert.deepEqual([res.status, res.body.code], [400, "payment_not_supported"]);
    }
    assert.ok(draftOf(demo), "el borrador se conserva");
  });
});

describe("flujo cotizar y confirmar", () => {
  it("quote y confirm con el mismo wamid: rechazo", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "quote", quoteBody(demo))).status, 200);
    const res = await call(demo, "confirm", confirmBody({ inboundWamid: "w1" }));
    assert.deepEqual([res.status, res.body.code], [409, "not_confirmed"]);
    assert.equal(demo.store.payment_intents.length, 0);
  });

  it("un wamid anterior al que cotizó no sirve para confirmar", async () => {
    const demo = newDemo();
    assert.equal((await call(demo, "quote", quoteBody(demo, { inboundWamid: "w2" }))).status, 200);
    const res = await call(demo, "confirm", confirmBody({ inboundWamid: "w1" }));
    assert.deepEqual([res.status, res.body.code], [409, "not_confirmed"]);
  });

  it("cotiza y confirma con un mensaje posterior: abre el pago de Mercado Pago", async () => {
    const demo = newDemo();
    const q = await call(demo, "quote", quoteBody(demo));
    assert.equal(q.status, 200);
    assert.equal(q.body.total, 9100);
    assert.equal((demo.store.wa_conversations[0]!.state as { draft: { quotedByMessageId: string } }).draft.quotedByMessageId, "w1");

    const c = await call(demo, "confirm", confirmBody());
    assert.equal(c.status, 200);
    assert.equal(c.body.awaiting_payment, true);
    assert.equal(c.body.payment_url, "https://pago.test/abc");
    assert.equal(demo.store.payment_intents.length, 1);
  });

  it("idempotencia: dos confirm con la misma clave crean un solo pago y devuelven lo mismo", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    const first = await call(demo, "confirm", confirmBody());
    const second = await call(demo, "confirm", confirmBody());
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.body.replayed, true);
    assert.equal(second.body.payment_url, first.body.payment_url);
    assert.equal(demo.store.payment_intents.length, 1);
  });

  it("sin Idempotency-Key (o distinta del wamid) en confirm y cancel: 400", async () => {
    const demo = newDemo();
    await call(demo, "quote", quoteBody(demo));
    assert.equal((await call(demo, "confirm", confirmBody(), { key: null })).status, 400);
    assert.equal((await call(demo, "confirm", confirmBody(), { key: "otra" })).status, 400);
    assert.equal((await call(demo, "cancel", { conversationId: CONV, inboundWamid: "w3", confirmed: true }, { key: null })).status, 400);
    assert.equal(demo.store.payment_intents.length, 0);
  });
});

describe("cancel", () => {
  async function withCashOrder(): Promise<DemoDb> {
    const demo = newDemo();
    const deps = (id: string) => ({ db: demo.db, conversationId: CONV, messageId: id, dryRun: false, now: () => T0, geocode: async () => [NEAR], gateway: () => fakeGateway });
    await quoteOrder(deps("w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    await confirmOrder(deps("w2"), { payment_method: "Efectivo" });
    return demo;
  }

  it("sin confirmed:true no cancela", async () => {
    const demo = await withCashOrder();
    for (const extra of [{}, { confirmed: false }]) {
      const res = await call(demo, "cancel", { conversationId: CONV, inboundWamid: "w3", ...extra });
      assert.deepEqual([res.status, res.body.code], [400, "not_confirmed"]);
    }
    assert.equal(demo.store.orders.at(-1)!.status, "Recibidos");
  });

  it("con confirmed:true cancela un pedido 'Recibidos' (actor bot) y es idempotente", async () => {
    const demo = await withCashOrder();
    const body = { conversationId: CONV, inboundWamid: "w3", confirmed: true };
    const res = await call(demo, "cancel", body);
    assert.equal(res.status, 200);
    assert.equal(demo.store.orders.at(-1)!.status, "Cancelado");
    assert.ok(demo.store.order_events.some((e) => e.event === "Cancelado" && e.actor === "bot"));
    const again = await call(demo, "cancel", body);
    assert.equal(again.status, 200);
    assert.equal(again.body.replayed, true);
  });

  it("fuera de 'Recibidos' no cancela", async () => {
    const demo = await withCashOrder();
    demo.store.orders.at(-1)!.status = "En Preparación";
    const res = await call(demo, "cancel", { conversationId: CONV, inboundWamid: "w3", confirmed: true });
    assert.equal(res.status, 409);
    assert.equal(demo.store.orders.at(-1)!.status, "En Preparación");
  });
});

describe("order-actions endurecido", () => {
  const deps = (demo: DemoDb, id: string, extra = {}) => ({
    db: demo.db, conversationId: CONV, messageId: id, dryRun: false, now: () => T0, geocode: async () => [NEAR], gateway: () => fakeGateway, ...extra,
  });

  it("reloadConversation devuelve error si no hay fila o la lectura falla (no cae al valor viejo)", async () => {
    const demo = newDemo();
    const stale = demo.store.wa_conversations[0] as never;
    const missing = await reloadConversation({ ...deps(demo, "w1"), conversationId: "nope", conversation: stale });
    assert.equal(isActionError(missing), true);

    const broken = { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "boom" } }) }) }) }) };
    const failing = await reloadConversation({ ...deps(demo, "w1"), db: broken as never, conversation: stale });
    assert.equal(isActionError(failing), true);

    const ok = await reloadConversation({ ...deps(demo, "w1"), conversationId: undefined, conversation: stale });
    assert.equal(isActionError(ok), false);
  });

  it("si algo lanza después del claim, el borrador vuelve y se devuelve error", async () => {
    const demo = newDemo();
    await quoteOrder(deps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    const boom = () => ({ createCheckout: async () => { throw new Error("pasarela caída"); } }) as never;
    const out = await confirmOrder(deps(demo, "w2", { gateway: boom }), { payment_method: "Mercado Pago" });
    assert.equal(isActionError(out), true);
    assert.ok(draftOf(demo), "el borrador se restauró");
    const retry = await confirmOrder(deps(demo, "w2"), { payment_method: "Mercado Pago" });
    assert.equal((retry as { awaiting_payment?: boolean }).awaiting_payment, true);
  });

  it("claim perdido: error con code claim_lost y sin pedido", async () => {
    const demo = newDemo();
    await quoteOrder(deps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    // Otro proceso toca la conversación justo después de leerla: updated_at ya no coincide.
    const racing = {
      from: (table: string) => {
        const builder = demo.db.from(table as never) as never as Record<string, (...a: unknown[]) => unknown>;
        if (table !== "wa_conversations") return builder;
        const select = builder.select!.bind(builder);
        builder.select = (...a: unknown[]) => {
          const query = select(...a) as { maybeSingle: () => Promise<{ data: unknown }> };
          const maybeSingle = query.maybeSingle.bind(query);
          query.maybeSingle = async () => {
            const result = await maybeSingle();
            const copy = { ...result, data: structuredClone(result.data) };
            demo.store.wa_conversations[0]!.updated_at = iso(5);
            return copy;
          };
          return query;
        };
        return builder;
      },
    };
    const before = demo.store.orders.length;
    const out = await confirmOrder(deps(demo, "w2", { db: racing as never }), { payment_method: "Efectivo" });
    assert.equal((out as { code?: string }).code, "claim_lost");
    assert.equal(demo.store.orders.length, before);
  });

  it("minutesSince usa el reloj inyectado", async () => {
    const demo = newDemo();
    await quoteOrder(deps(demo, "w1"), { items: [{ product_id: productId(demo), qty: 1 }], address: "Av. Corrientes 1234" });
    await confirmOrder(deps(demo, "w2"), { payment_method: "Efectivo" });
    const { orderStatus } = await import("../src/lib/agent/order-actions.ts");
    const later = new Date(Date.now() + 90 * 60_000);
    const status = await orderStatus(deps(demo, "w3", { now: () => later }));
    assert.ok((status as { minutes_since_order: number }).minutes_since_order >= 90);
  });
});
