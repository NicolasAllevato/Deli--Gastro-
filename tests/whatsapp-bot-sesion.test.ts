/** Contexto por pedido: la sesión del bot arranca después de un pedido cerrado o de un rato largo sin actividad. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { closesOrder, sessionStart, DEFAULT_SESSION_IDLE_MIN, sessionIdleMs, type TimedMessage } from "../workers/whatsapp-bot/src/bot/session.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import type { BotRepo, HistoryItem } from "../workers/whatsapp-bot/src/repo/types.ts";
import { QUOTE_MARKER, CASH_MARKER } from "../workers/whatsapp-bot/src/orders/flow.ts";

const T0 = Date.parse("2026-11-23T12:00:00.000Z");
const min = (n: number): Date => new Date(T0 + n * 60_000);
const m = (direction: "in" | "out", body: string, at: number): TimedMessage => ({ direction, body, at: min(at) });
const IDLE = 150 * 60_000;

describe("sessionStart (puro)", () => {
  it("sin corte: toda la charla es una sesión", () => {
    assert.equal(sessionStart([m("in", "hola", 0), m("out", "¡Hola!", 1), m("in", "una muzza", 2)], IDLE), null);
  });

  it("un pedido confirmado cierra la sesión: la sesión nueva empieza en el siguiente mensaje del cliente", () => {
    const items = [
      m("in", "2 muzzas a Juramento 1500", 0), m("out", `${QUOTE_MARKER}:\n2 x Muzza`, 1), m("in", "efectivo", 2),
      m("out", `${CASH_MARKER} ✅ Número de pedido: #1.`, 3), m("in", "hola de nuevo", 10),
    ];
    assert.equal(sessionStart(items, IDLE)?.getTime(), min(10).getTime());
  });

  it("cancelado y «dejamos ese pedido» también cierran", () => {
    for (const body of ["Listo, cancelamos tu pedido.", "Listo, cancelamos tu pedido 👍. No se cobró nada.", "Listo, dejamos ese pedido sin confirmar: no se cobró nada.", "Tu pedido ya está cancelado."]) {
      assert.equal(closesOrder(m("out", body, 0)), true, body);
      assert.equal(sessionStart([m("out", body, 0), m("in", "quiero otra", 5)], IDLE)?.getTime(), min(5).getTime(), body);
    }
  });

  it("el link de pago pendiente NO cierra (el pedido sigue en curso)", () => {
    const link = "¡Listo! Para confirmar tu pedido pagá con Mercado Pago acá: https://x";
    assert.equal(closesOrder(m("out", link, 0)), false);
    assert.equal(sessionStart([m("out", link, 0), m("in", "ya pagué", 5)], IDLE), null);
  });

  it("solo los mensajes del bot cierran", () => {
    assert.equal(closesOrder(m("in", CASH_MARKER, 0)), false);
  });

  it("resumen abandonado: más de 150 min sin actividad corta; justo en el límite no", () => {
    const base = [m("in", "una muzza a Juramento 1500", 0), m("out", `${QUOTE_MARKER}:\n1 x Muzza`, 1)];
    assert.equal(sessionStart([...base, m("in", "hola", 1 + 151)], IDLE)?.getTime(), min(152).getTime());
    assert.equal(sessionStart([...base, m("in", "hola", 1 + 150)], IDLE), null);
  });

  it("varios mensajes del cliente en la misma ráfaga: la sesión empieza en el primero", () => {
    const items = [m("out", `${CASH_MARKER} ✅`, 0), m("in", "hola", 20), m("in", "quiero una muzza", 20.5)];
    assert.equal(sessionStart(items, IDLE)?.getTime(), min(20).getTime());
  });

  it("gana el corte más reciente", () => {
    const items = [m("in", "a", 0), m("out", `${CASH_MARKER} ✅`, 1), m("in", "b", 5), m("out", "ok", 6), m("in", "c", 6 + 200), m("out", "ok", 6 + 201), m("in", "d", 6 + 205)];
    assert.equal(sessionStart(items, IDLE)?.getTime(), min(206).getTime());
  });

  it("minutos de configuración: por defecto 150, inválido o menor a 1 vuelve al defecto", () => {
    assert.equal(DEFAULT_SESSION_IDLE_MIN, 150);
    assert.equal(sessionIdleMs({}), 150 * 60_000);
    assert.equal(sessionIdleMs({ bot_sesion_inactividad_min: 180 }), 180 * 60_000);
    assert.equal(sessionIdleMs({ bot_sesion_inactividad_min: "120" }), 120 * 60_000);
    assert.equal(sessionIdleMs({ bot_sesion_inactividad_min: 0 }), 150 * 60_000);
    assert.equal(sessionIdleMs({ bot_sesion_inactividad_min: "x" }), 150 * 60_000);
  });
});

/** Repo en memoria con horas: `history` respeta `since` como el real. */
function timedRepo(messages: TimedMessage[], opts: { closedAt?: Date | null } = {}) {
  const sent: string[] = [];
  const base: HistoryItem[] = messages.map((x) => ({ direction: x.direction, body: x.body, at: x.at }));
  const repo: BotRepo = {
    getConversation: async (phone) => ({ id: "c1", phone, clientId: "cl1", displayName: "Ana", humanTakeover: false }),
    history: async (_id, limit, since) => base.filter((h) => !since || (h.at as Date) >= since).slice(-limit),
    recentMessages: async () => [...messages],
    ...(opts.closedAt !== undefined ? { lastClosedOrderAt: async () => opts.closedAt ?? null } : {}),
    inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
    config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_orders_enabled: false }),
    menu: async () => [{ id: "p1", name: "Muzza", description: null, price: 9000, category: "Pizzas" }],
    zones: async () => [],
    latestOrder: async () => null,
    setTakeover: async () => {},
    setMarketingOptIn: async () => 1,
    saveOutbound: async (_c, _w, body) => { sent.push(body); },
    saveTranscript: async () => {},
    lastOutboundAt: async () => messages.filter((x) => x.direction === "out").at(-1)?.at ?? null,
  };
  return { repo, sent };
}

/** Modelo falso que guarda lo que ve el respondedor. */
function spyRun(intent = "consulta_menu") {
  const modelSaw: string[][] = [];
  const run = async (_model: string, input: Record<string, unknown>) => {
    if ("response_format" in input) return { response: JSON.stringify({ intent, confidence: 0.95 }) };
    modelSaw.push((input.messages as { role: string; content?: string }[]).map((x) => `${x.role}: ${x.content ?? ""}`));
    return { response: "Tenemos Muzza a $9.000" };
  };
  return { run, modelSaw };
}

const deps = (repo: BotRepo, run: TurnDeps["run"]): TurnDeps => {
  let n = 0;
  return { repo, run, transcribe: async () => null, send: async () => `o${++n}`, appUrl: "https://dely.opsyn.app", log: () => {} };
};
const turnOf = (text: string) => ({ phone: "5491100000001", text, wamids: ["w1"], audios: [], receivedAt: 0 });

describe("turno: el historial que ve el modelo empieza en la sesión", () => {
  it("después de un pedido confirmado el modelo no ve la charla vieja", async () => {
    const msgs = [
      m("in", "quiero la promo con gaseosas", -300), m("out", "¿Qué gaseosa preferís?", -299),
      m("out", `${CASH_MARKER} ✅ Número de pedido: #9.`, -280), m("in", "qué pizzas tienen?", 0),
    ];
    const { repo } = timedRepo(msgs);
    const { run, modelSaw } = spyRun();
    await processTurn(turnOf("qué pizzas tienen?"), deps(repo, run));
    const joined = modelSaw.flat().join("\n");
    assert.ok(modelSaw.length > 0);
    assert.doesNotMatch(joined, /gaseosa/);
    assert.doesNotMatch(joined, /Número de pedido/);
  });

  it("con un resumen en curso reciente el modelo sigue viendo la charla", async () => {
    const msgs = [m("in", "quiero una muzza a Juramento 1500", -10), m("out", `${QUOTE_MARKER}:\n1 x Muzza`, -9), m("in", "y tienen coca?", 0)];
    const { repo } = timedRepo(msgs);
    const { run, modelSaw } = spyRun();
    await processTurn(turnOf("y tienen coca?"), deps(repo, run));
    assert.match(modelSaw.flat().join("\n"), /una muzza a Juramento 1500/);
  });

  it("un resumen abandonado (más de 150 min) no se arrastra", async () => {
    const msgs = [m("in", "una muzza a Juramento 1500", -400), m("out", `${QUOTE_MARKER}:\n1 x Muzza`, -399), m("in", "sacá las medialunas", 0)];
    const { repo } = timedRepo(msgs);
    const { run, modelSaw } = spyRun();
    await processTurn(turnOf("sacá las medialunas"), deps(repo, run));
    const joined = modelSaw.flat().join("\n");
    assert.doesNotMatch(joined, /Juramento/);
    assert.doesNotMatch(joined, /Resumen de tu pedido/);
  });

  it("un pedido entregado/cancelado en la app corta la sesión salvo que haya un resumen pendiente", async () => {
    const closedAt = min(-30);
    const sinPendiente = [m("in", "quiero la promo", -50), m("out", "¿Cuáles gaseosas?", -49), m("in", "hola", 0)];
    const a = timedRepo(sinPendiente, { closedAt });
    const ra = spyRun();
    await processTurn(turnOf("hola"), deps(a.repo, ra.run));
    assert.doesNotMatch(ra.modelSaw.flat().join("\n"), /gaseosas/);

    const conPendiente = [m("in", "una muzza a Juramento 1500", -50), m("out", `${QUOTE_MARKER}:\n1 x Muzza`, -49), m("in", "tienen coca?", 0)];
    const b = timedRepo(conPendiente, { closedAt });
    const rb = spyRun();
    await processTurn(turnOf("tienen coca?"), deps(b.repo, rb.run));
    assert.match(rb.modelSaw.flat().join("\n"), /una muzza a Juramento 1500/);
  });

  it("el repo no borra nada: history sin since devuelve todo (el panel sigue mostrando la charla entera)", async () => {
    const { repo } = timedRepo([m("out", `${CASH_MARKER} ✅`, -100), m("in", "hola", 0)]);
    assert.equal((await repo.history("c1", 50)).length, 2);
  });
});
