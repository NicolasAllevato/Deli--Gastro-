import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import {
  QUOTE_MARKER, PAYMENT_QUESTION, renderFinalSummary, renderQuoteSummary, paymentChoice, pendingThread, switchPayment, pendingReminder,
} from "../workers/whatsapp-bot/src/orders/flow.ts";
import { processTurn, NOTHING_PENDING_REPLY, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { addMessage, combineBatch, emptyBatch, flushAt, BATCH_POLICY } from "../workers/whatsapp-bot/src/batching.ts";
import type { OrdersClient, OrderResponse } from "../workers/whatsapp-bot/src/orders/client.ts";
import type { BotRepo, HistoryItem } from "../workers/whatsapp-bot/src/repo/types.ts";

const PHONE = "5491100000009";
const PID = "11111111-1111-4111-8111-111111111111";

const FIRST = renderQuoteSummary(
  { lines: [{ name: "Muzzarella grande", qty: 1, price: 18000 }], subtotal: 18000, delivery_fee: 1500, total: 19500, resolved_address: "5000, Avenida Rivadavia, Caballito", points: 90 },
  "Av Rivadavia 5000 piso 3 dto B",
)!;
const CASH_FINAL = renderFinalSummary(FIRST, "Efectivo")!;

/** Conversación en memoria: cada turno agrega el entrante y las respuestas del bot al historial. */
function world(intent: string, final: string, opts: { history?: HistoryItem[]; toolCalls?: Array<{ name: string; arguments: unknown }>; quotePoints?: number; lastOut?: Date | null } = {}) {
  const log: HistoryItem[] = [...(opts.history ?? [])];
  const sent: string[] = [];
  const calls: string[] = [];
  const repo: BotRepo = {
    getConversation: async (phone) => ({ id: "c1", phone, clientId: "cl1", displayName: "Ana", humanTakeover: false }),
    history: async (_c, limit) => log.slice(-limit),
    inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
    config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_orders_enabled: true }),
    menu: async () => [{ id: PID, name: "Muzzarella grande", description: null, price: 18000, category: "Pizzas" }],
    zones: async () => [],
    latestOrder: async () => null,
    setTakeover: async () => {},
    setMarketingOptIn: async () => 1,
    saveOutbound: async (_c, _w, body) => { sent.push(body); log.push({ direction: "out", body }); },
    saveTranscript: async () => {},
    ...(opts.lastOut !== undefined ? { lastOutboundAt: async () => opts.lastOut ?? null } : {}),
  };
  const ok = (data: Record<string, unknown>): OrderResponse => ({ ok: true, status: 200, data: { ok: true, ...data } });
  const orders: OrdersClient = {
    quote: async () => {
      calls.push("quote");
      return ok({ lines: [{ name: "Muzzarella grande", qty: 1, price: 18000 }], subtotal: 18000, delivery_fee: 1500, total: 19500, resolved_address: "5000, Avenida Rivadavia, Caballito", points: opts.quotePoints ?? 0 });
    },
    confirm: async () => { calls.push("confirm"); return ok({ order_code: "A-12", total: 19500 }); },
    cancel: async () => { calls.push("cancel"); return ok({}); },
    status: async () => ok({ found: false }),
  };
  const toolCalls = opts.toolCalls ?? [];
  let classified = 0;
  const run: TurnDeps["run"] = async (_m, input) => {
    if ("response_format" in input) { classified++; return { response: JSON.stringify({ intent, confidence: 0.95 }) }; }
    const used = (input.messages as { role: string }[]).filter((m) => m.role === "tool").length;
    return used < toolCalls.length ? { tool_calls: [toolCalls[used]] } : { response: final };
  };
  let n = 0;
  const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://dely.opsyn.app", orders, log: () => {} };
  let w = 0;
  const send = (text: string) => {
    log.push({ direction: "in", body: text });
    return processTurn({ phone: PHONE, text, wamids: [`w${++w}`], audios: [], receivedAt: 0 }, deps);
  };
  return { send, sent, calls, classifiedCount: () => classified };
}

describe("hilo del pedido: cambio de tema con un resumen pendiente", () => {
  it("a) resumen final → «pasame la carta» → carta + recordatorio; «sí» → resumen de nuevo; «sí» → confirma", async () => {
    const w = world("consulta_menu", "Tenemos pizzas, empanadas y postres 🍕", { history: [{ direction: "out", body: CASH_FINAL }] });
    await w.send("pasame la carta");
    assert.match(w.sent.at(-1)!, /Tenemos pizzas/);
    assert.match(w.sent.at(-1)!, /Tenés un pedido sin confirmar \(\$19\.500\)\. ¿Seguimos\? Respondé SÍ para confirmar\./);
    await w.send("sí");
    assert.equal(w.sent.at(-1), CASH_FINAL, "con otro tema en el medio el SÍ no confirma a ciegas: se reenvía el resumen");
    assert.deepEqual(w.calls, []);
    await w.send("sí");
    assert.deepEqual(w.calls, ["confirm"]);
    assert.match(w.sent.at(-1)!, /^¡Listo! Tu pedido quedó confirmado/);
  });

  it("c) primer resumen → «¿a qué hora cierran?» → horario + repregunta de pago; «efectivo» → resumen final", async () => {
    const w = world("consulta_local", "Cerramos a las 23:59.", { history: [{ direction: "out", body: FIRST }] });
    await w.send("¿a qué hora cierran?");
    assert.match(w.sent.at(-1)!, /^Cerramos a las 23:59\./);
    assert.ok(w.sent.at(-1)!.endsWith(`Tenés un pedido sin confirmar ($19.500). ${PAYMENT_QUESTION}`));
    await w.send("efectivo");
    assert.equal(w.sent.at(-1), CASH_FINAL);
  });

  it("una respuesta de «no entendí» tampoco corta el hilo", () => {
    const t = pendingThread(["¿Me contás un poco más qué necesitás?", "📄 Te mandé la carta en PDF.", CASH_FINAL]);
    assert.equal(t.decisive, CASH_FINAL);
    assert.equal(t.sideReplies, 2);
    // Un cierre del pedido (confirmación) sí corta el hilo.
    assert.equal(pendingThread(["hola", "¡Listo! Tu pedido quedó confirmado ✅", CASH_FINAL]).decisive, null);
    // Fuera de la ventana ya no cuenta.
    assert.equal(pendingThread([...Array(8).fill("charla"), CASH_FINAL]).decisive, null);
  });
});

describe("hilo del pedido: cambiar la forma de pago en el resumen final", () => {
  it("b) resumen final en efectivo → «Mercado» → resumen final con Mercado Pago (sin confirmar)", async () => {
    const w = world("otro", "x", { history: [{ direction: "out", body: CASH_FINAL }] });
    await w.send("Mercado");
    assert.equal(w.sent.at(-1), renderFinalSummary(FIRST, "Mercado Pago"));
    assert.deepEqual(w.calls, []);
    assert.equal(w.classifiedCount(), 0);
    await w.send("mejor efectivo");
    assert.equal(w.sent.at(-1), CASH_FINAL);
  });

  it("paymentChoice entiende «Mercado», «mejor», «cambio a» y «link»", () => {
    for (const t of ["Mercado", "mercado pago", "mp", "con mp", "link", "cambio a mp", "mejor con mercado pago"]) assert.equal(paymentChoice(t), "Mercado Pago", t);
    for (const t of ["mejor efectivo", "cambio a efectivo", "en efectivo porfa"]) assert.equal(paymentChoice(t), "Efectivo", t);
    assert.equal(paymentChoice("efectivo o mp"), null);
    assert.equal(paymentChoice("quiero 2 muzzas"), null);
  });

  it("switchPayment conserva productos, dirección y puntos", () => {
    const mp = switchPayment(CASH_FINAL, "Mercado Pago")!;
    assert.match(mp, /^Pago: Mercado Pago$/m);
    assert.doesNotMatch(mp, /Efectivo/);
    assert.match(mp, /Muzzarella grande/);
    assert.match(mp, /⭐ Sumás 90 puntos/);
    assert.equal(switchPayment(mp, "Efectivo"), CASH_FINAL);
    assert.equal(pendingReminder("hola"), null);
  });
});

describe("hilo del pedido: SÍ sin nada pendiente", () => {
  it("d) responde «¿Qué te gustaría pedir?», no el genérico", async () => {
    const w = world("otro", "x", { history: [{ direction: "out", body: "Cerramos a las 23:59." }] });
    await w.send("sí");
    assert.equal(w.sent.at(-1), NOTHING_PENDING_REPLY);
    assert.deepEqual(w.calls, []);
  });
});

describe("mensajes apilados", () => {
  it("e) «hola» + «quiero una muzza grande» + «a Rivadavia 5000» en segundos → un turno y una sola respuesta (gana el pedido)", async () => {
    const t0 = 1_000_000;
    let batch = emptyBatch();
    batch = addMessage(batch, { wamid: "a", text: "hola", at: t0, kind: "text" });
    batch = addMessage(batch, { wamid: "b", text: "quiero una muzza grande", at: t0 + 2_000, kind: "text" });
    batch = addMessage(batch, { wamid: "c", text: "a Rivadavia 5000", at: t0 + 4_500, kind: "text" });
    // Sigue escribiendo: la respuesta espera el silencio después del ÚLTIMO mensaje.
    assert.equal(flushAt(batch), t0 + 4_500 + BATCH_POLICY.quietMs);
    const combined = combineBatch(batch);
    assert.deepEqual(combined.wamids, ["a", "b", "c"]);
    assert.equal(combined.text, "hola\nquiero una muzza grande\na Rivadavia 5000");

    const quoteCall = { name: "quote_order", arguments: { items: [{ product_id: PID, qty: 1 }], address: "Rivadavia 5000" } };
    // Charla nueva (sin respuestas previas): igual no sale un saludo aparte.
    const w = world("pedido_nuevo", "x", { toolCalls: [quoteCall], lastOut: null });
    await w.send(combined.text);
    assert.equal(w.sent.length, 1);
    assert.ok(w.sent[0].startsWith(QUOTE_MARKER));
  });

  it("la ventana de silencio alcanza para tipear en WhatsApp y tiene un tope", () => {
    assert.ok(BATCH_POLICY.quietMs >= 4_000 && BATCH_POLICY.quietMs <= 6_000);
    assert.ok(BATCH_POLICY.maxWaitMs >= 10_000 && BATCH_POLICY.maxWaitMs <= 20_000);
  });
});

describe("puntos en el resumen", () => {
  it("f) el resumen muestra los puntos del servidor y el resumen final los conserva", async () => {
    const quoteCall = { name: "quote_order", arguments: { items: [{ product_id: PID, qty: 1 }], address: "Rivadavia 5000" } };
    const w = world("pedido_nuevo", "Total $1 inventado, sumás 999 puntos", { toolCalls: [quoteCall], quotePoints: 90, history: [{ direction: "out", body: "¿Qué querés pedir?" }] });
    await w.send("una muzza grande a Rivadavia 5000");
    assert.match(w.sent.at(-1)!, /^⭐ Sumás 90 puntos con esta compra$/m);
    assert.doesNotMatch(w.sent.at(-1)!, /999/);
    await w.send("efectivo");
    assert.match(w.sent.at(-1)!, /^⭐ Sumás 90 puntos con esta compra$/m);
    assert.match(w.sent.at(-1)!, /^Pago: Efectivo$/m);
  });

  it("sin puntos (0 o ausente) no hay línea de puntos", () => {
    const base = { lines: [{ name: "Muzza", qty: 1, price: 9000 }], subtotal: 9000, delivery_fee: 0, total: 9000, resolved_address: "Belgrano 123" };
    assert.doesNotMatch(renderQuoteSummary({ ...base, points: 0 })!, /puntos/);
    assert.doesNotMatch(renderQuoteSummary(base)!, /puntos/);
    assert.match(renderQuoteSummary({ ...base, points: 45.7 })!, /Sumás 45 puntos/);
  });
});
