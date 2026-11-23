/** Búsqueda que no niega lo que existe (humita, cerveza sin alcohol), prompt sin ejemplos copiables y recordatorio del portal. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alcoholFilter, cartaCategoryForModel, categoryForModel, isAlcoholic, productsForCategory } from "../workers/whatsapp-bot/src/bot/menu.ts";
import { buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { portalReminderDue, PORTAL_LINE, portalIdleHours } from "../workers/whatsapp-bot/src/bot/portal.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import type { BotRepo, CartaSeccion, MenuItem } from "../workers/whatsapp-bot/src/repo/types.ts";

const item = (id: string, name: string, category: string, price = 1000): MenuItem => ({ id, name, description: null, price, category });
const MENU: MenuItem[] = [
  item("1", "Empanada Humita", "Empanadas"), item("2", "Empanada de carne", "Empanadas"), item("3", "Muzzarella grande", "Pizzas"),
  item("4", "Quilmes (Lata Zero 473)", "Bebidas"), item("5", "Stella Artois (Lata Zero)", "Bebidas"), item("6", "Quilmes 1L", "Bebidas"),
  item("7", "Pepsi Chica", "Bebidas"), item("8", "Seven Up Zero Chica", "Bebidas"),
];
const names = (items: MenuItem[]): string[] => items.map((p) => p.name);

describe("búsqueda: no niega lo que existe", () => {
  it("«empanadas de humita» encuentra Empanada Humita aunque el nombre no diga «de»", () => {
    assert.deepEqual(names(productsForCategory(MENU, "empanadas de humita")), ["Empanada Humita"]);
    assert.deepEqual(names(productsForCategory(MENU, "humita")), ["Empanada Humita"]);
    assert.equal((categoryForModel(MENU, "empanadas de humita", false) as { encontrado: boolean }).encontrado, true);
  });
  it("lo que no existe sigue sin inventarse", () => {
    assert.deepEqual(productsForCategory(MENU, "sushi"), []);
    assert.deepEqual(productsForCategory(MENU, "empanadas de sushi"), []);
  });
  it("«cerveza sin alcohol» devuelve las Zero; «bebidas sin alcohol» no trae cervezas con alcohol", () => {
    assert.deepEqual(names(productsForCategory(MENU, "cerveza sin alcohol")).sort(), ["Quilmes (Lata Zero 473)", "Stella Artois (Lata Zero)"]);
    const soft = names(productsForCategory(MENU, "bebidas sin alcohol"));
    assert.ok(soft.includes("Pepsi Chica") && soft.includes("Quilmes (Lata Zero 473)"));
    assert.ok(!soft.includes("Quilmes 1L"));
  });
  it("las cervezas Zero no cuentan como alcohólicas", () => {
    assert.equal(isAlcoholic("Quilmes (Lata Zero 473)"), false);
    assert.equal(isAlcoholic("Cerveza 0,0 Andes"), false);
    assert.equal(isAlcoholic("Quilmes 1L"), true);
    assert.equal(alcoholFilter("tienen cerveza sin alcohol?"), "cerveza_sin");
    assert.equal(alcoholFilter("bebidas sin alcohol"), "sin");
  });
  it("con carta estructurada: humita y cerveza sin alcohol también salen", () => {
    const linea = (nombre: string, id: string) => ({ nombre, nota: null, productos: [{ id, price: 1000 }] });
    const carta: CartaSeccion[] = [
      { titulo: "Empanadas", columnas: [], estilo: "gustos", nota: null, items: [linea("Carne", "2"), linea("Humita", "1")] },
      { titulo: "Bebidas", columnas: [], estilo: "lista", nota: null, items: [linea("Quilmes (Lata Zero 473)", "4"), linea("Quilmes 1L", "6"), linea("Pepsi Chica", "7")] },
    ];
    const h = JSON.stringify(cartaCategoryForModel(carta, "empanadas de humita", false, MENU));
    assert.match(h, /Humita/);
    const c = JSON.stringify(cartaCategoryForModel(carta, "cerveza sin alcohol", false, MENU));
    assert.match(c, /Zero 473/);
    assert.doesNotMatch(c, /Quilmes 1L|Pepsi/);
  });
});

describe("prompt: sin ejemplos literales para copiar", () => {
  it("no menciona sushi y el «no lo trabajamos» nombra lo que pidió el cliente", () => {
    const prompt = buildResponderPrompt(settingsFromConfig({ bot_orders_enabled: true }), "consulta_menu", null, false);
    assert.doesNotMatch(prompt, /sushi/i);
    assert.match(prompt, /lo que pidió el cliente/);
  });
});

describe("recordatorio del portal (lo decide el código)", () => {
  const T = Date.parse("2026-11-23T12:00:00.000Z");
  const mk = (direction: "in" | "out", body: string, minAgo: number) => ({ direction, body, at: new Date(T - minAgo * 60_000) });
  it("por defecto cada 24 h; 0 lo apaga; inválido vuelve a 24", () => {
    assert.equal(portalIdleHours({}), 24);
    assert.equal(portalIdleHours({ bot_portal_recordatorio_horas: 6 }), 6);
    assert.equal(portalIdleHours({ bot_portal_recordatorio_horas: "0" }), 0);
    assert.equal(portalIdleHours({ bot_portal_recordatorio_horas: "x" }), 24);
  });
  it("corresponde si nunca se mandó o pasaron más de N horas; no si fue hace poco", () => {
    assert.equal(portalReminderDue([mk("out", "Tenemos pizzas", 5)], T, 24), true);
    assert.equal(portalReminderDue([mk("out", `Hola\n\n${PORTAL_LINE("https://x.app")}`, 60)], T, 24), false);
    assert.equal(portalReminderDue([mk("out", `Hola\n\n${PORTAL_LINE("https://x.app")}`, 25 * 60)], T, 24), true);
    assert.equal(portalReminderDue([], T, 0), false);
  });
  it("la línea apunta al portal", () => {
    assert.equal(PORTAL_LINE("https://x.app"), "También podés pedir directo desde nuestra web: https://x.app/cliente");
  });

  function setup(draft: string, intent: string, history: { direction: "in" | "out"; body: string; at: Date }[] = [], config: Record<string, unknown> = {}) {
    const sent: string[] = [];
    const repo: BotRepo = {
      getConversation: async (phone) => ({ id: "c1", phone, clientId: null, displayName: null, humanTakeover: false }),
      history: async () => [{ direction: "in", body: "pregunta" }],
      recentMessages: async () => [...history, { direction: "in", body: "pregunta", at: new Date(T) }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_orders_enabled: false, ...config }),
      menu: async () => MENU, zones: async () => [], latestOrder: async () => null, setTakeover: async () => {}, setMarketingOptIn: async () => 1,
      saveOutbound: async () => {}, saveTranscript: async () => {}, lastOutboundAt: async () => new Date(),
    };
    const run = async (_m: string, input: Record<string, unknown>) =>
      "response_format" in input ? { response: JSON.stringify({ intent, confidence: 0.95 }) } : { response: draft };
    let n = 0;
    const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async (_p, t) => { sent.push(t); return `o${++n}`; }, appUrl: "https://x.app", log: () => {} };
    return { deps, sent };
  }
  const turn = { phone: "5491100000001", text: "cuánto sale la muzza?", wamids: ["w1"], audios: [], receivedAt: Date.now() };

  it("una consulta de precios recibe la línea; la segunda dentro de la ventana no", async () => {
    const a = setup("La muzza sale $1.000", "consulta_menu");
    await processTurn(turn, a.deps);
    assert.match(a.sent.at(-1) ?? "", /También podés pedir directo desde nuestra web: https:\/\/x\.app\/cliente$/);
    const recent = [{ direction: "out" as const, body: `Algo\n\n${PORTAL_LINE("https://x.app")}`, at: new Date(Date.now() - 30 * 60_000) }];
    const b = setup("La muzza sale $1.000", "consulta_menu", recent);
    await processTurn(turn, b.deps);
    assert.doesNotMatch(b.sent.at(-1) ?? "", /pedir directo/);
  });
  it("no se agrega en saludos, estado de pedido ni con el recordatorio apagado", async () => {
    for (const intent of ["saludo", "pedido_estado"]) {
      const s = setup("Hola!", intent);
      await processTurn(turn, s.deps);
      assert.doesNotMatch(s.sent.join("\n"), /pedir directo/, intent);
    }
    const off = setup("La muzza sale $1.000", "consulta_menu", [], { bot_portal_recordatorio_horas: 0 });
    await processTurn(turn, off.deps);
    assert.doesNotMatch(off.sent.join("\n"), /pedir directo/);
  });
});
