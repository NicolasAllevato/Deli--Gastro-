import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import {
  daysMentioned, firstName, GREETING_GAP_MS, isNewConversation, promosForToday, renderGreeting,
} from "../workers/whatsapp-bot/src/bot/greeting.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { buildResponderPrompt, closedTicketReply, orderReply } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { toolsFor } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import type { BotRepo, ComplaintInput, ComplaintTicket, MenuItem } from "../workers/whatsapp-bot/src/repo/types.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";

const { listReclamos, setReclamoEstado } = await import("../src/lib/data/reclamos.ts");

/** Fechas en hora de Argentina (UTC-3, sin horario de verano). 2026-11-16 es lunes. */
const ar = (day: number, hour: number) => new Date(Date.UTC(2026, 10, day, hour + 3, 0));
const LUNES = 16, VIERNES = 20, SABADO = 21, MIERCOLES = 18;

const item = (name: string, price = 10000, category = "Promos"): MenuItem => ({ id: name, name, description: null, price, category });
const MENU: MenuItem[] = [
  item("PROMO LUNES 2 MUZZAS"),
  item("PROMO MARTES EMPANADAS"),
  item("PROMO MIÉRCOLES Y JUEVES"),
  item("PROMO FINDE FAMILIAR", 25000),
  item("PROMO ALMUERZO EJECUTIVO", 8000),
  item("PROMO CENA PAREJA", 20000),
  item("SEÑA EVENTO"),
  item("Adicional papas"),
  item("PROMO CLÁSICA", 15000),
  item("Muzza", 9000, "Pizzas"),
];
const names = (menu: MenuItem[], d: Date) => promosForToday(menu, d).map((p) => p.name);

describe("promos del día", () => {
  it("lunes al mediodía: la del lunes, las sin día y el almuerzo; nunca señas ni adicionales ni otra categoría", () => {
    assert.deepEqual(names(MENU, ar(LUNES, 12)), ["PROMO LUNES 2 MUZZAS", "PROMO ALMUERZO EJECUTIVO", "PROMO CLÁSICA"]);
  });

  it("CENA solo desde las 18 y ALMUERZO solo antes de las 16", () => {
    assert.deepEqual(names(MENU, ar(LUNES, 16)), ["PROMO LUNES 2 MUZZAS", "PROMO CLÁSICA"]);
    assert.deepEqual(names(MENU, ar(LUNES, 20)), ["PROMO LUNES 2 MUZZAS", "PROMO CENA PAREJA", "PROMO CLÁSICA"]);
  });

  it("FINDE = viernes, sábado y domingo; tildes y mayúsculas no importan", () => {
    assert.ok(names(MENU, ar(VIERNES, 20)).includes("PROMO FINDE FAMILIAR"));
    assert.ok(names(MENU, ar(SABADO, 13)).includes("PROMO FINDE FAMILIAR"));
    assert.ok(!names(MENU, ar(MIERCOLES, 13)).includes("PROMO FINDE FAMILIAR"));
    assert.ok(names(MENU, ar(MIERCOLES, 13)).includes("PROMO MIÉRCOLES Y JUEVES"));
  });

  it("rangos de días y máximo 5", () => {
    assert.deepEqual([...daysMentioned("promo lunes a jueves")].sort(), [1, 2, 3, 4]);
    const many = Array.from({ length: 8 }, (_, i) => item(`PROMO ${i}`));
    assert.equal(promosForToday(many, ar(LUNES, 12)).length, 5);
  });

  it("el día se toma en hora de Argentina (lunes 23:30 AR ya es martes en UTC)", () => {
    const lateMonday = new Date(Date.UTC(2026, 10, 17, 2, 30));
    assert.ok(names(MENU, lateMonday).includes("PROMO LUNES 2 MUZZAS"));
  });
});

const OPEN = { agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59" };

describe("saludo", () => {
  it("con nombre del cliente y de agente: el texto que pidió el dueño", () => {
    const s = settingsFromConfig({ ...OPEN, negocio_nombre: "La Gambeta", agente_nombre: "Gambe" });
    const text = renderGreeting(s, "Tata Pérez", [item("PROMO CLÁSICA", 15000)]);
    assert.ok(text.startsWith("¡Hola, Tata! 👋 Soy Gambe, el asistente de La Gambeta. Te ayudo con lo que necesites: consultame cualquier duda o armamos tu pedido. ¿Qué querés pedir hoy?"));
    assert.match(text, /Promos de hoy:\n• PROMO CLÁSICA — \$15\.000/);
  });

  it("sin nombre del cliente ni de agente", () => {
    const s = settingsFromConfig({ ...OPEN, negocio_nombre: "La Gambeta" });
    const text = renderGreeting(s, null, []);
    assert.equal(text, "¡Hola! 👋 Soy el asistente de La Gambeta. Te ayudo con lo que necesites: consultame cualquier duda o armamos tu pedido. ¿Qué querés pedir hoy?");
  });

  it("nunca ofrece una persona; cerrado dice el horario en vez de pedir", () => {
    const s = settingsFromConfig({ agente_activo: true, horario_apertura: "11:00", horario_cierre: "12:00", negocio_nombre: "La Gambeta", agente_nombre: "Gambe" });
    const text = renderGreeting(s, "Tata", [], ar(LUNES, 20));
    assert.match(text, /cerrados; tomamos pedidos de 11:00 a 12:00/);
    assert.doesNotMatch(text, /persona|humano/i);
    assert.doesNotMatch(orderReply("https://x.app", settingsFromConfig(OPEN)), /persona|humano/i);
  });

  it("primer nombre y charla nueva (sin mensajes del bot o más de 6 h)", () => {
    assert.equal(firstName("  Tata  Gómez"), "Tata");
    assert.equal(firstName("😀"), null);
    assert.equal(firstName(null), null);
    const now = Date.now();
    assert.equal(isNewConversation(null, now), true);
    assert.equal(isNewConversation(new Date(now - GREETING_GAP_MS - 1), now), true);
    assert.equal(isNewConversation(new Date(now - 60_000), now), false);
  });
});

// ---------- turno completo con un repo en memoria ----------

function world(opts: { intent: string; lastOut: Date | null; config?: Record<string, unknown>; toolCalls?: Array<{ name: string; arguments: unknown }>; final?: string }) {
  const sent: string[] = [];
  const complaints: ComplaintInput[] = [];
  const state = { takeover: false };
  let open: ComplaintTicket | null = null;
  const repo: BotRepo = {
    getConversation: async (phone) => ({ id: "c1", phone, clientId: "cl1", displayName: "Tata Pérez", humanTakeover: state.takeover }),
    history: async () => [{ direction: "in", body: "hola" }],
    inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
    config: async () => ({ ...OPEN, negocio_nombre: "La Gambeta", agente_nombre: "Gambe", ...opts.config }),
    menu: async () => [item("PROMO CLÁSICA", 15000)],
    zones: async () => [],
    latestOrder: async () => null,
    setTakeover: async () => { state.takeover = true; },
    setMarketingOptIn: async () => 1,
    saveOutbound: async (_c, _w, body) => { sent.push(body); },
    saveTranscript: async () => {},
    lastOutboundAt: async () => opts.lastOut,
    createComplaint: async (c) => {
      complaints.push(c);
      if (open) return { ...open, created: false };
      open = { id: "r1", numero: 7, created: true, categoria: c.categoria ?? "otro", orderId: c.orderId ?? null, fotos: 0, createdAt: new Date() };
      return open;
    },
    openComplaint: async () => open,
  };
  const toolCalls = opts.toolCalls ?? [];
  const run: TurnDeps["run"] = async (_m, input) => {
    if ("response_format" in input) return { response: JSON.stringify({ intent: opts.intent, confidence: 0.95 }) };
    const used = (input.messages as { role: string }[]).filter((m) => m.role === "tool").length;
    return used < toolCalls.length ? { tool_calls: [toolCalls[used]] } : { response: opts.final ?? "¿Algo más?" };
  };
  let n = 0;
  const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://opsyndely.la-gambeta.com", log: () => {} };
  const send = (text: string) => processTurn({ phone: "5491170000001", text, wamids: ["w1"], audios: [], receivedAt: 0 }, deps);
  return { send, sent, complaints, state };
}

const CLOSED = { horario_apertura: "03:00", horario_cierre: "03:01" };

describe("turno: saludo primero", () => {
  it("«quiero pedir» como primer mensaje recibe el saludo con promos, no el link a la web", async () => {
    const w = world({ intent: "pedido_nuevo", lastOut: null });
    assert.equal(await w.send("hola quiero pedir"), "greeted");
    assert.equal(w.sent.length, 1);
    assert.match(w.sent[0], /^¡Hola, Tata! 👋 Soy Gambe, el asistente de La Gambeta/);
    assert.match(w.sent[0], /PROMO CLÁSICA — \$15\.000/);
    assert.doesNotMatch(w.sent[0], /\/cliente|persona/);
  });

  it("un primer mensaje con pedido concreto (cantidades en palabras) no se pierde detrás del saludo", async () => {
    const w = world({ intent: "pedido_nuevo", lastOut: null });
    assert.notEqual(await w.send("dame una napo y dos empanadas de carne y una coca de litro y medio"), "greeted");
    assert.ok(w.sent.length >= 1);
    assert.doesNotMatch(w.sent.join("\n"), /¡Hola, Tata! 👋 Soy Gambe/);
  });

  it("«hola quiero pedir» sin cantidades ni productos sigue recibiendo solo el saludo", async () => {
    const w = world({ intent: "pedido_nuevo", lastOut: null });
    assert.equal(await w.send("hola quiero pedir"), "greeted");
  });

  it("con charla reciente no saluda de nuevo", async () => {
    const w = world({ intent: "pedido_nuevo", lastOut: new Date() });
    assert.equal(await w.send("quiero pedir"), "order_redirect");
    assert.doesNotMatch(w.sent[0], /¡Hola/);
  });

  it("tras más de 6 h saluda de nuevo y, si pregunta algo concreto, además lo responde", async () => {
    const w = world({ intent: "consulta_local", lastOut: new Date(Date.now() - GREETING_GAP_MS - 60_000), final: "Abrimos todos los días." });
    assert.equal(await w.send("a qué hora abren?"), "answered");
    assert.equal(w.sent.length, 2);
    assert.match(w.sent[0], /^¡Hola, Tata!/);
    assert.equal(w.sent[1], "Abrimos todos los días.");
  });
});

describe("turno: quejas según el horario", () => {
  it("abierto: pedir una persona deriva como siempre (human_takeover), sin ticket", async () => {
    const w = world({ intent: "humano", lastOut: new Date() });
    assert.equal(await w.send("quiero hablar con alguien"), "answered");
    assert.equal(w.state.takeover, true);
    assert.equal(w.complaints.length, 0);
  });

  it("cerrado: pedir una persona registra un ticket, no silencia al bot y avisa cuándo abre", async () => {
    const w = world({ intent: "humano", lastOut: new Date(), config: CLOSED });
    assert.equal(await w.send("me llegó frío, quiero hablar con alguien"), "ticket");
    assert.equal(w.state.takeover, false);
    assert.equal(w.complaints.length, 1);
    assert.match(w.complaints[0].motivo, /frío/);
    assert.match(w.sent[0], /Lo registramos \(reclamo #7\)\. Te contactamos cuando abramos a las 03:00\./);
    assert.equal(w.complaints[0].categoria, "llego_frio");
  });

  it("cerrado: si el modelo usa handoff_to_human, sale el aviso del ticket (no «te paso con una persona»)", async () => {
    const w = world({
      intent: "pedido_estado", lastOut: new Date(), config: CLOSED,
      toolCalls: [{ name: "handoff_to_human", arguments: { reason: "pedido incompleto" } }], final: "Te paso con una persona.",
    });
    assert.equal(await w.send("me faltó una pizza"), "ticket");
    assert.equal(w.state.takeover, false);
    assert.equal(w.complaints.length, 1);
    assert.match(w.complaints[0].motivo, /me faltó una pizza\npedido incompleto/);
    assert.match(w.sent[0], /reclamo #7/);
    assert.doesNotMatch(w.sent.join("\n"), /te paso con una persona/i);
  });

  it("el prompt cerrado prohíbe ofrecer una persona; abierto mantiene la derivación", () => {
    const closed = buildResponderPrompt(settingsFromConfig({ ...OPEN, ...CLOSED }), "pedido_estado", null, false);
    assert.match(closed, /CERRADO: no hay nadie para atender/);
    const open = buildResponderPrompt(settingsFromConfig(OPEN), "pedido_estado", null, false);
    assert.match(open, /usá handoff_to_human enseguida/);
    assert.match(open, /No ofrezcas hablar con una persona si el cliente no se queja ni lo pide/);
  });
});

describe("herramienta get_promos_hoy", () => {
  it("devuelve las promos de hoy con price_text", async () => {
    const w = world({ intent: "saludo", lastOut: new Date() });
    void w;
    const repo = { menu: async () => [item("PROMO CLÁSICA", 15000), item("Muzza", 9000, "Pizzas")] } as unknown as BotRepo;
    const tool = toolsFor("consulta_menu", repo, { id: "c1", phone: "1", clientId: null, displayName: null, humanTakeover: false }, settingsFromConfig(OPEN))
      .find((t) => t.name === "get_promos_hoy")!;
    assert.deepEqual(await tool.run({}), { promos: [{ name: "PROMO CLÁSICA", price_text: "$15.000", description: null }] });
  });
});

describe("repo D1: tickets y último mensaje del bot", () => {
  it("createComplaint guarda el ticket abierto; el admin lo lista y lo resuelve", async () => {
    const db = createTestDb();
    db.raw.exec("INSERT INTO wa_conversations (id, client_phone, contact_name) VALUES ('c1', '5491170000001', 'Tata')");
    const repo = d1BotRepo(db);
    assert.equal(await repo.lastOutboundAt!("c1"), null);
    await repo.saveOutbound("c1", "o1", "hola");
    assert.ok((await repo.lastOutboundAt!("c1")) instanceof Date);
    await repo.createComplaint!({ conversationId: "c1", phone: "5491170000001", clientId: null, motivo: "  llegó   frío " });
    const admin = { kind: "admin", userId: "u1" } as const;
    const [r] = await listReclamos(db, admin);
    assert.deepEqual([r.motivo, r.estado, r.client_name], ["llegó frío", "abierto", "Tata"]);
    assert.equal(await setReclamoEstado(db, admin, { id: r.id, estado: "resuelto" }), true);
    assert.equal((await listReclamos(db, admin))[0].estado, "resuelto");
    await assert.rejects(() => listReclamos(db, { kind: "cliente", userId: "x" } as const), /No autorizado/);
  });
});
