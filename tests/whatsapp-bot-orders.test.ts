import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createOrdersClient, signRequest, type OrdersClient, type OrderResponse, type OrderFailure } from "../workers/whatsapp-bot/src/orders/client.ts";
import { signBotRequest, verifyBotRequest } from "../src/lib/bot-internal/signature.ts";
import { isAffirmation, renderQuoteSummary, parseQuoteArgs, errorReply, imitatesTemplate, QUOTE_MARKER, CANCEL_MARKER, RETRY_CONFIRM, RETRY_CANCEL } from "../workers/whatsapp-bot/src/orders/flow.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { orderReply } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import "./helpers/alias.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { isTrustedPaymentUrl, trustedPaymentUrl } from "../workers/whatsapp-bot/src/guardrails.ts";
import type { BotRepo, HistoryItem } from "../workers/whatsapp-bot/src/repo/types.ts";
import type { InboundTurn } from "../workers/whatsapp-bot/src/turn-types.ts";

const { skipCreatedNotice, notifyOrderEvent } = await import("../src/lib/whatsapp/notify.ts");

const SECRET = "s".repeat(40);
const PHONE = "5491100000001";
const PID = "11111111-1111-4111-8111-111111111111";
const PAY = "https://www.mercadopago.com.ar/checkout/v1/redirect?pref_id=123-abc";

// ---------- cliente HTTP ----------

interface Captured { url: string; headers: Record<string, string>; body: string }

function fakeFetch(responses: Array<{ status: number; body?: unknown } | "network" | "hang">) {
  const calls: Captured[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
    const next = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (next === "network") throw new TypeError("fetch failed");
    if (next === "hang") {
      return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    }
    return new Response(JSON.stringify(next.body ?? { ok: true }), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

function clientWith(responses: Parameters<typeof fakeFetch>[0], timeoutMs = 8000) {
  const f = fakeFetch(responses);
  let t = 1_700_000_000_000;
  const sleeps: number[] = [];
  const client = createOrdersClient({
    baseUrl: "https://app.test/", secret: SECRET, fetchImpl: f.impl, timeoutMs,
    now: () => (t += 5000), sleep: async (ms) => { sleeps.push(ms); },
  });
  return { client, calls: f.calls, sleeps };
}

const common = { conversationId: "c1", inboundWamid: "wamid.X" };

describe("fase 5: cliente firmado", () => {
  it("la firma del Worker (Web Crypto) coincide con la de la app y la app la verifica", async () => {
    const parts = { timestamp: "1700000000", method: "POST", path: "/api/internal/bot/quote", body: '{"a":"ñ"}' };
    assert.equal(await signRequest(SECRET, parts), signBotRequest(SECRET, parts));
    const check = verifyBotRequest({ secrets: [SECRET], ...parts, timestamp: parts.timestamp, signature: await signRequest(SECRET, parts), nowMs: 1_700_000_000_000 });
    assert.deepEqual(check, { ok: true });
  });

  it("usa el path exacto, el header de idempotencia (wamid) en confirm/cancel y firma lo que envía", async () => {
    const { client, calls } = clientWith([{ status: 200, body: { ok: true } }]);
    await client.confirm({ ...common, payment_method: "Mercado Pago" });
    await client.status(common);
    assert.equal(calls[0].url, "https://app.test/api/internal/bot/confirm");
    assert.equal(calls[0].headers["idempotency-key"], "wamid.X");
    assert.equal(calls[1].url, "https://app.test/api/internal/bot/status");
    assert.equal(calls[1].headers["idempotency-key"], undefined);
    const c = calls[0];
    const check = verifyBotRequest({
      secrets: [SECRET], method: "POST", path: "/api/internal/bot/confirm", body: c.body,
      timestamp: c.headers["x-bot-timestamp"], signature: c.headers["x-bot-signature"], nowMs: Number(c.headers["x-bot-timestamp"]) * 1000,
    });
    assert.deepEqual(check, { ok: true });
  });

  it("reintenta 5xx/429/red con timestamp nuevo en cada intento y se rinde a los 3", async () => {
    const { client, calls, sleeps } = clientWith([{ status: 503, body: { ok: false, code: "unavailable", error: "x" } }]);
    const r = await client.quote({ ...common, items: [{ product_id: PID, qty: 1 }], address: "Calle 123" });
    assert.equal(calls.length, 3);
    assert.equal(new Set(calls.map((c) => c.headers["x-bot-timestamp"])).size, 3);
    assert.equal(sleeps.length, 2);
    assert.equal(r.ok, false);
    const net = clientWith(["network", { status: 200, body: { ok: true, found: false } }]);
    assert.equal((await net.client.status(common)).ok, true);
    assert.equal(net.calls.length, 2);
    const rate = clientWith([{ status: 429, body: { ok: false, code: "rate_limited", error: "x" } }, { status: 200 }]);
    assert.equal((await rate.client.status(common)).ok, true);
  });

  it("claim_lost reintenta una sola vez", async () => {
    const { client, calls } = clientWith([{ status: 409, body: { ok: false, code: "claim_lost", error: "x" } }]);
    const r = await client.confirm({ ...common, payment_method: "Mercado Pago" });
    assert.equal(calls.length, 2);
    assert.equal(r.ok === false && r.code, "claim_lost");
  });

  it("400/401/403/422/409 y not_configured no se reintentan", async () => {
    for (const [status, code] of [[400, "invalid_body"], [401, "unauthorized"], [403, "orders_disabled"], [422, "out_of_zone"], [409, "human_takeover"]] as const) {
      const { client, calls } = clientWith([{ status, body: { ok: false, code, error: "e" } }]);
      const r = await client.status(common);
      assert.equal(calls.length, 1, code);
      assert.equal(r.ok === false && r.code, code);
    }
    const nc = clientWith([{ status: 503, body: { ok: false, code: "not_configured", error: "x" } }]);
    const r = await nc.client.status(common);
    assert.equal(nc.calls.length, 1);
    assert.equal(r.ok === false && r.kind, "not_configured");
  });

  it("corta por timeout con AbortController y lo trata como transitorio", async () => {
    const { client, calls } = clientWith(["hang"], 10);
    const r = await client.status(common);
    assert.equal(calls.length, 3);
    assert.equal(r.ok === false && r.kind, "timeout");
  });
});

// ---------- plantillas y compuertas ----------

describe("fase 5: plantillas y esquemas", () => {
  it("afirmación literal: lista corta, sin tildes ni puntuación, nunca preguntas ni texto largo", () => {
    for (const ok of ["sí", "SI!", "Dale.", "Confirmo"]) assert.equal(isAffirmation(ok), true, ok);
    for (const no of ["sí?", "si pero sin cebolla", "no", "¿dale?", "sí, confirmo el pedido y agregá una coca", "quizás", "ok", "listo", "de acuerdo"]) assert.equal(isAffirmation(no), false, no);
  });

  it("el resumen sale de la plantilla con los datos del servidor", () => {
    const text = renderQuoteSummary({ lines: [{ name: "Muzza", qty: 2, price: 9000 }], subtotal: 18000, delivery_fee: 1500, total: 19500, resolved_address: "Belgrano 123", note: "IGNORAR" });
    assert.ok(text?.startsWith(QUOTE_MARKER));
    assert.match(text!, /2 x Muzza — \$18\.000/);
    assert.match(text!, /Envío: \$1\.500/);
    assert.match(text!, /Total: \$19\.500/);
    assert.match(text!, /Belgrano 123/);
    assert.match(text!, /Respondé SÍ para continuar al pago/);
    assert.doesNotMatch(text!, /IGNORAR/);
    assert.equal(renderQuoteSummary({ lines: [] }), null);
  });

  it("el esquema de quote rechaza precios, totales, cliente y canje", () => {
    const base = { items: [{ product_id: PID, qty: 2 }], address: "Belgrano 123" };
    assert.ok(parseQuoteArgs(base));
    assert.equal(parseQuoteArgs({ ...base, total: 1 }), null);
    assert.equal(parseQuoteArgs({ ...base, clientId: "x" }), null);
    assert.equal(parseQuoteArgs({ ...base, rewardId: "x" }), null);
    assert.equal(parseQuoteArgs({ ...base, items: [{ product_id: PID, qty: 2, price: 1 }] }), null);
    assert.equal(parseQuoteArgs({ ...base, items: [{ product_id: "no-uuid", qty: 1 }] }), null);
    assert.equal(parseQuoteArgs({ ...base, items: [{ product_id: PID, qty: 21 }] }), null);
  });

  it("solo se confía en links https de Mercado Pago", () => {
    assert.equal(isTrustedPaymentUrl(PAY), true);
    assert.equal(isTrustedPaymentUrl("https://mpago.la/abc"), true);
    assert.equal(isTrustedPaymentUrl("http://mpago.la/abc"), false);
    assert.equal(isTrustedPaymentUrl("https://mercadopago.com.ar.evil.com/x"), false);
    assert.equal(isTrustedPaymentUrl("nada"), false);
    assert.equal(trustedPaymentUrl("https://MPAGO.la/abc"), "https://mpago.la/abc");
  });

  it("cada código del servidor tiene un mensaje claro y ninguno pasa a una persona", () => {
    const f = (code: string, error = "Fuera de zona.", extra: Partial<OrderFailure> = {}) =>
      errorReply({ ok: false, kind: "api", status: 422, code, error, ...extra }, { appUrl: "https://app.test", hours: { open: "11:00", close: "23:00" } });
    for (const code of ["orders_disabled", "not_configured"]) assert.match(f(code), /no están disponibles.*https:\/\/app\.test\/cliente/);
    assert.match(f("limit_exceeded", "Pasaste el tope de unidades."), /Pasaste el tope de unidades\..*https:\/\/app\.test\/cliente/);
    assert.equal(f("forbidden"), "Reintentá en un momento.");
    assert.match(f("human_takeover"), /persona del local/);
    for (const code of ["out_of_zone", "min_order", "total_changed"]) assert.match(f(code), /Fuera de zona\. Si querés, armamos el pedido de nuevo/);
    assert.match(f("closed"), /Atendemos de 11:00 a 23:00/);
    assert.doesNotMatch(f("closed"), /armamos/);
    assert.match(f("product_unavailable"), /no lo encontré, ¿me decís cuál querés\?/);
    for (const code of ["no_draft", "expired", "not_confirmed", "claim_lost"]) assert.match(f(code), /ya no está vigente/);
    assert.equal(f("rejected", "Pasaron más de 15 minutos desde el pedido."), "Pasaron más de 15 minutos desde el pedido.");
    assert.equal(f("http_409", "Ya está en preparación."), "Ya está en preparación.");
    const cancel = errorReply({ ok: false, kind: "api", status: 409, code: "rejected", error: "No encontré un pedido para cancelar." }, { appUrl: "x", op: "cancel" });
    assert.equal(cancel, "No tenés un pedido en curso.");
    assert.match(f("unavailable"), /Tuve un problema/);
  });
});

// ---------- turno ----------

function setup(opts: { enabled: boolean; history?: HistoryItem[]; orders?: Partial<OrdersClient> }) {
  const sent: string[] = [];
  const state = { takeover: false };
  const history = opts.history ?? [{ direction: "in", body: "hola" }];
  const repo: BotRepo = {
    getConversation: async (phone) => (phone === PHONE ? { id: "c1", phone, clientId: "cl1", displayName: "Ana", humanTakeover: state.takeover } : null),
    history: async () => [...history],
    inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
    config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_orders_enabled: opts.enabled }),
    menu: async () => [{ id: PID, name: "Muzza", description: null, price: 9000, category: "Pizzas" }],
    zones: async () => [],
    latestOrder: async () => null,
    setTakeover: async () => { state.takeover = true; },
    setMarketingOptIn: async () => 1,
    saveOutbound: async (_c, _w, body) => { sent.push(body); },
    saveTranscript: async () => {},
  };
  const calls: string[] = [];
  const statusCalls: string[] = [];
  const ok = (data: Record<string, unknown>): OrderResponse => ({ ok: true, status: 200, data: { ok: true, ...data } });
  const orders: OrdersClient = {
    quote: async () => { calls.push("quote"); return ok({ lines: [{ name: "Muzza", qty: 2, price: 9000 }], subtotal: 18000, delivery_fee: 1500, total: 19500, resolved_address: "Belgrano 123" }); },
    confirm: async () => { calls.push("confirm"); return ok({ awaiting_payment: true, payment_url: PAY, total: 19500 }); },
    cancel: async () => { calls.push("cancel"); return ok({}); },
    status: async () => { statusCalls.push("status"); return ok({ found: false }); },
    ...opts.orders,
  };
  return { repo, sent, state, orders, calls, statusCalls };
}

/** Modelo falso: clasifica `intent` y, en el respondedor, ejecuta `toolCalls` en orden y después contesta `final`. */
function model(intent: string, final: string, toolCalls: Array<{ name: string; arguments: unknown }> = []) {
  const toolsSeen: string[][] = [];
  const run = async (_m: string, input: Record<string, unknown>) => {
    if ("response_format" in input) return { response: JSON.stringify({ intent, confidence: 0.95 }) };
    toolsSeen.push(((input.tools as { function: { name: string } }[] | undefined) ?? []).map((t) => t.function.name));
    const used = (input.messages as { role: string }[]).filter((m) => m.role === "tool").length;
    if (used < toolCalls.length) return { tool_calls: [toolCalls[used]] };
    return { response: final };
  };
  return { run, toolsSeen };
}

function deps(s: ReturnType<typeof setup>, run: TurnDeps["run"], withOrders = true): TurnDeps {
  let n = 0;
  return { repo: s.repo, run, transcribe: async () => null, send: async () => `out-${++n}`, appUrl: "https://dely.opsyn.app", orders: withOrders ? s.orders : undefined, log: () => {} };
}

const turn = (text: string, wamid = "w2"): InboundTurn => ({ phone: PHONE, text, wamids: [wamid], audios: [], receivedAt: 0 });
const SUMMARY = `${QUOTE_MARKER}:\n• 2 x Muzza — $18.000\nTotal: $19.500\nRespondé SÍ para continuar al pago.`;
const quoteCall = { name: "quote_order", arguments: { items: [{ product_id: PID, qty: 2 }], address: "Belgrano 123" } };
const confirmCall = { name: "confirm_order", arguments: { payment_method: "Mercado Pago" } };

describe("fase 5: con el flag apagado el camino es el de siempre", () => {
  it("los pedidos se derivan a la web aunque haya cliente de pedidos", async () => {
    const s = setup({ enabled: false });
    const m = model("pedido_nuevo", "x");
    assert.equal(await processTurn(turn("quiero 2 muzzas"), deps(s, m.run)), "order_redirect");
    assert.equal(s.sent[0], orderReply("https://dely.opsyn.app", settingsFromConfig(await s.repo.config())));
    assert.equal(s.calls.length, 0);
  });

  it("un SÍ después de un resumen no llama a la app y get_menu no expone ids", async () => {
    const s = setup({ enabled: false, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "si" }] });
    const m = model("pedido_confirmar", "x");
    assert.equal(await processTurn(turn("si"), deps(s, m.run)), "order_redirect");
    assert.equal(s.calls.length, 0);
    const menu = setup({ enabled: false });
    let toolOutput = "";
    const run = async (_m: string, input: Record<string, unknown>) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "consulta_menu", confidence: 0.9 }) };
      const tool = (input.messages as { role: string; content: string }[]).find((x) => x.role === "tool");
      if (tool) { toolOutput = tool.content; return { response: "ok" }; }
      return { tool_calls: [{ name: "get_menu", arguments: {} }] };
    };
    await processTurn(turn("que hay"), deps(menu, run));
    assert.doesNotMatch(toolOutput, /"id"/);
  });

  it("con flag encendido pero sin secreto (sin cliente) avisa que no está disponible", async () => {
    const s = setup({ enabled: true });
    assert.equal(await processTurn(turn("quiero pizza"), deps(s, model("pedido_nuevo", "x").run, false)), "order_redirect");
    assert.match(s.sent[0], /no están disponibles/);
  });
});

describe("fase 5: pedidos con el flag encendido", () => {
  it("cotizar: el cliente recibe la plantilla fija, no el texto del modelo", async () => {
    const s = setup({ enabled: true });
    const m = model("pedido_nuevo", "Total $1 (inventado)", [quoteCall]);
    assert.equal(await processTurn(turn("2 muzzas a Belgrano 123"), deps(s, m.run)), "answered");
    assert.deepEqual(s.calls, ["quote"]);
    assert.equal(s.sent.length, 1);
    assert.ok(s.sent[0].startsWith(QUOTE_MARKER));
    assert.match(s.sent[0], /Total: \$19\.500/);
    assert.doesNotMatch(s.sent[0], /inventado/);
    assert.ok(m.toolsSeen[0].includes("quote_order"));
  });

  it("confirm_order en el mismo turno que quote_order se rechaza", async () => {
    const s = setup({ enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "si" }] });
    const m = model("pedido_nuevo", "listo", [quoteCall, confirmCall]);
    // texto no afirmativo: va por el modelo; aun así el confirm no pasa
    await processTurn(turn("sí, dale con 2 muzzas a Belgrano 123"), deps(s, m.run));
    assert.deepEqual(s.calls, ["quote"]);
  });

  it("confirm_order con un mensaje que no es afirmación literal se rechaza", async () => {
    const s = setup({ enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "x" }] });
    const m = model("pedido_confirmar", "¿Confirmás?", [confirmCall]);
    await processTurn(turn("sí pero sin cebolla"), deps(s, m.run));
    assert.deepEqual(s.calls, []);
    const q = setup({ enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "x" }] });
    await processTurn(turn("¿cuánto sale el envío?"), deps(q, model("pedido_confirmar", "$1500", [confirmCall]).run));
    assert.deepEqual(q.calls, []);
  });

  it("confirm_order sin que el cliente haya visto el resumen o con otro medio de pago se rechaza", async () => {
    const s = setup({ enabled: true, history: [{ direction: "out", body: "¿Qué querés pedir?" }, { direction: "in", body: "si" }] });
    await processTurn(turn("si"), deps(s, model("pedido_confirmar", "ok", [confirmCall]).run));
    assert.deepEqual(s.calls, []);
    const t = setup({ enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "x" }] });
    await processTurn(turn("hola"), deps(t, model("pedido_confirmar", "ok", [{ name: "confirm_order", arguments: { payment_method: "Efectivo" } }]).run));
    assert.deepEqual(t.calls, []);
    assert.match(t.sent[0], /solo se puede pagar con Mercado Pago/);
  });

  it("SÍ literal tras el resumen confirma y manda EXACTAMENTE el payment_url del servidor", async () => {
    const s = setup({ enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "Sí!" }] });
    const m = model("saludo", "x");
    assert.equal(await processTurn(turn("Sí!"), deps(s, m.run)), "answered");
    assert.deepEqual(s.calls, ["confirm"]);
    assert.ok(s.sent[0].includes(PAY));
    assert.match(s.sent[0], /\$19\.500/);
  });

  it("si el servidor devuelve un link que no es de Mercado Pago, no se le manda", async () => {
    const s = setup({
      enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "si" }],
      orders: { confirm: async () => ({ ok: true, status: 200, data: { ok: true, awaiting_payment: true, payment_url: "https://evil.example/pay", total: 1 } }) },
    });
    await processTurn(turn("si"), deps(s, model("x", "x").run));
    assert.doesNotMatch(s.sent[0], /evil/);
    assert.match(s.sent[0], /Tuve un problema/);
  });

  it("el wamid y la conversación los pone el turno, no el modelo", async () => {
    let seen: unknown;
    const s = setup({ enabled: true, orders: { quote: async (body) => { seen = body; return { ok: false, kind: "api", status: 422, code: "out_of_zone", error: "Estás fuera de la zona." }; } } });
    const m = model("pedido_nuevo", "x", [{ name: "quote_order", arguments: { ...quoteCall.arguments } }]);
    await processTurn(turn("2 muzzas", "wamid.REAL"), deps(s, m.run));
    assert.deepEqual(seen, { conversationId: "c1", inboundWamid: "wamid.REAL", items: [{ product_id: PID, qty: 2 }], address: "Belgrano 123" });
    assert.match(s.sent[0], /fuera de la zona\. Si querés, armamos el pedido de nuevo/i);
  });

  it("argumentos con precios o total no llegan a la app", async () => {
    const s = setup({ enabled: true });
    const bad = { name: "quote_order", arguments: { ...quoteCall.arguments, total: 1 } };
    await processTurn(turn("2 muzzas"), deps(s, model("pedido_nuevo", "ok", [bad]).run));
    assert.deepEqual(s.calls, []);
  });

  it("limit_exceeded y forbidden NO pasan la conversación a humano", async () => {
    for (const [code, expected] of [["limit_exceeded", /web/], ["forbidden", /Reintentá/]] as const) {
      const s = setup({
        enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "si" }],
        orders: { confirm: async () => ({ ok: false, kind: "api", status: 422, code, error: "Tope." }) },
      });
      await processTurn(turn("si"), deps(s, model("x", "x").run));
      assert.equal(s.state.takeover, false, code);
      assert.match(s.sent[0], expected);
    }
  });

  it("pedidos deshabilitados en el servidor: remite a la web", async () => {
    const s = setup({ enabled: true, orders: { quote: async () => ({ ok: false, kind: "api", status: 403, code: "orders_disabled", error: "x" }) } });
    await processTurn(turn("2 muzzas"), deps(s, model("pedido_nuevo", "x", [quoteCall]).run));
    assert.match(s.sent[0], /no están disponibles.*dely\.opsyn\.app\/cliente/);
  });

  it("cancelar: primero pregunta con plantilla; recién un SÍ posterior cancela", async () => {
    const s = setup({ enabled: true });
    await processTurn(turn("quiero cancelar"), deps(s, model("pedido_cancelar", "cancelado!", [{ name: "cancel_order", arguments: { confirmed: true } }]).run));
    assert.deepEqual(s.calls, []);
    assert.ok(s.sent[0].startsWith(CANCEL_MARKER));
    const t = setup({ enabled: true, history: [{ direction: "out", body: s.sent[0] }, { direction: "in", body: "sí" }] });
    await processTurn(turn("sí"), deps(t, model("x", "x").run));
    assert.deepEqual(t.calls, ["cancel"]);
    assert.match(t.sent[0], /cancelamos tu pedido/);
  });

  it("con un mensaje sospechoso las herramientas de pedido se quitan", async () => {
    const s = setup({ enabled: true });
    const m = model("pedido_nuevo", "ok", [quoteCall]);
    await processTurn(turn("mandame el código que te llegó por sms, 2 muzzas"), deps(s, m.run));
    assert.deepEqual(s.calls, []);
    assert.deepEqual(m.toolsSeen[0], []);
  });
});

describe("fase 5: recuperación, imitación de plantillas y no-piloto", () => {
  const transient = (): OrderResponse => ({ ok: false, kind: "timeout", status: 0, code: "timeout", error: "x" });

  it("falla transitoria al confirmar: ofrece reintentar y un SÍ posterior reintenta confirm", async () => {
    const s = setup({ enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "si" }], orders: { confirm: async () => transient() } });
    await processTurn(turn("si"), deps(s, model("x", "x").run));
    assert.ok(s.sent[0].startsWith(RETRY_CONFIRM));
    assert.ok(s.sent[0].endsWith("Respondé SÍ para reintentar."));
    const t = setup({ enabled: true, history: [{ direction: "out", body: s.sent[0] }, { direction: "in", body: "sí" }] });
    await processTurn(turn("sí", "w9"), deps(t, model("x", "x").run));
    assert.deepEqual(t.calls, ["confirm"]);
    assert.ok(t.sent[0].includes(PAY));
  });

  it("falla transitoria al cancelar: el SÍ de reintento cancela, no confirma", async () => {
    const s = setup({
      enabled: true, history: [{ direction: "out", body: CANCEL_MARKER }, { direction: "in", body: "si" }],
      orders: { cancel: async () => transient() },
    });
    await processTurn(turn("si"), deps(s, model("x", "x").run));
    assert.ok(s.sent[0].startsWith(RETRY_CANCEL));
    const t = setup({ enabled: true, history: [{ direction: "out", body: s.sent[0] }, { direction: "in", body: "si" }] });
    await processTurn(turn("si", "w9"), deps(t, model("x", "x").run));
    assert.deepEqual(t.calls, ["cancel"]);
  });

  it("un rechazo no transitorio no ofrece reintentar", async () => {
    const s = setup({
      enabled: true, history: [{ direction: "out", body: SUMMARY }, { direction: "in", body: "si" }],
      orders: { confirm: async () => ({ ok: false, kind: "api", status: 422, code: "out_of_zone", error: "Estás fuera de zona." }) },
    });
    await processTurn(turn("si"), deps(s, model("x", "x").run));
    assert.doesNotMatch(s.sent[0], /reintentar/);
  });

  it("el modelo no puede imitar el resumen, la pregunta de cancelar ni el reintento", async () => {
    for (const fake of [SUMMARY, `${CANCEL_MARKER} Respondé SÍ`, `${RETRY_CONFIRM} Respondé SÍ para reintentar.`, "resumen de tu pedido: 1 muzza"]) {
      assert.equal(imitatesTemplate(fake), true, fake);
      const s = setup({ enabled: true });
      assert.equal(await processTurn(turn("hola"), deps(s, model("consulta_menu", fake).run)), "output_blocked");
      assert.ok(!s.sent[0].startsWith(QUOTE_MARKER) && !s.sent[0].startsWith(CANCEL_MARKER));
      assert.equal(s.state.takeover, false);
    }
    assert.equal(imitatesTemplate("Tenemos Muzza a $9.000"), false);
  });

  it("un SÍ sin resumen a la vista no deja un callejón: pide empezar de nuevo", async () => {
    const s = setup({ enabled: true, history: [{ direction: "out", body: "Dale, quedó anotado." }, { direction: "in", body: "si" }] });
    await processTurn(turn("si"), deps(s, model("pedido_confirmar", "x", [confirmCall]).run));
    assert.deepEqual(s.calls, []);
    assert.match(s.sent[0], /armo el resumen/);
  });

  it("fuera de la allowlist: pedido_nuevo responde sin gastar el modelo", async () => {
    const s = setup({ enabled: true, orders: { status: async () => ({ ok: false, kind: "api", status: 403, code: "orders_disabled", error: "x" }) } });
    const m = model("pedido_nuevo", "x", [quoteCall]);
    let responderCalls = 0;
    const run = async (name: string, input: Record<string, unknown>) => { if (!("response_format" in input)) responderCalls++; return m.run(name, input); };
    assert.equal(await processTurn(turn("2 muzzas"), deps(s, run)), "order_redirect");
    assert.equal(responderCalls, 0);
    assert.match(s.sent[0], /no están disponibles/);
  });

  it("fuera de la allowlist: order_status cae al camino legacy de la base", async () => {
    const s = setup({ enabled: true, orders: { status: async () => ({ ok: false, kind: "api", status: 403, code: "orders_disabled", error: "x" }) } });
    let toolOutput = "";
    const run = async (_m: string, input: Record<string, unknown>) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "pedido_estado", confidence: 0.9 }) };
      const tool = (input.messages as { role: string; content: string }[]).find((x) => x.role === "tool");
      if (tool) { toolOutput = tool.content; return { response: "Tu pedido va en camino" }; }
      return { tool_calls: [{ name: "order_status", arguments: {} }] };
    };
    await processTurn(turn("¿y mi pedido?"), deps(s, run));
    assert.match(toolOutput, /"found":false/);
    assert.doesNotMatch(s.sent[0], /no están disponibles/);
  });

  it("el flag acepta true y \"true\" como el servidor", () => {
    assert.equal(settingsFromConfig({ bot_orders_enabled: true }).ordersEnabled, true);
    assert.equal(settingsFromConfig({ bot_orders_enabled: "true" }).ordersEnabled, true);
    for (const v of [false, "false", "1", 1, null, undefined]) assert.equal(settingsFromConfig({ bot_orders_enabled: v }).ordersEnabled, false);
  });
});

describe("fase 5: aviso al cliente tras pagar con Mercado Pago (app)", () => {
  it("solo se omite el aviso de pedido creado para pedidos del chat que no son de Mercado Pago", () => {
    assert.equal(skipCreatedNotice({ channel: "whatsapp", payment_method: "Efectivo" }), true);
    assert.equal(skipCreatedNotice({ channel: "whatsapp", payment_method: "Mercado Pago" }), false);
    assert.equal(skipCreatedNotice({ channel: "web", payment_method: "Efectivo" }), false);
  });

  it("notifyOrderEvent: el pedido de WhatsApp pagado con MP sigue hasta buscar al cliente; el de efectivo no", async () => {
    const run = async (payment_method: string) => {
      const tables: string[] = [];
      const db = {
        from(table: string) {
          tables.push(table);
          const q = { select: () => q, eq: () => q, limit: () => q, maybeSingle: async () => ({ data: table === "orders" ? { id: "o1", channel: "whatsapp", payment_method, client_id: "c1" } : null }) };
          return q;
        },
      };
      await notifyOrderEvent(db as never, "o1", "created");
      return tables;
    };
    assert.ok((await run("Mercado Pago")).includes("clients"));
    assert.ok(!(await run("Efectivo")).includes("clients"));
  });
});

// ---------- dependencias ----------

describe("el Worker no depende de Next ni de Supabase", () => {
  it("ningún import de next/* ni @/utils/supabase/* en workers/whatsapp-bot/src", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts")) files.push(full);
      }
    };
    walk("workers/whatsapp-bot/src");
    assert.ok(files.length > 10);
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      assert.doesNotMatch(source, /from\s+["'](next(\/|["'])|@\/utils\/supabase|@supabase)/, file);
      assert.doesNotMatch(source, /from\s+["'][^"']*bot-internal\//, file);
    }
  });
});
