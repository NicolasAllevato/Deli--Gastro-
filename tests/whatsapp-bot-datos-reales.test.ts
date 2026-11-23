/**
 * Fallas vistas en producción (bot 952563dd) que el menú de ejemplo del simulador no reflejaba:
 *  A) «No tenemos empanadas de humita» cuando existe «Empanada Humita» (el modelo no consultó el menú);
 *  B) «hola, quiero la promo Baila Ahora» recibía solo el saludo;
 *  C) cliente registrado con `phone_digits` NULL: no se encontraba su pedido y se le pedía la dirección; y la dirección del geocoder salía entera.
 */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { shortAddress } from "../workers/whatsapp-bot/src/repo/short-address.ts";
import { deniesExistingProduct } from "../workers/whatsapp-bot/src/bot/draft-checks.ts";
import { draftIssue, openingHasContent, processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import type { BotRepo, MenuItem } from "../workers/whatsapp-bot/src/repo/types.ts";

const item = (name: string, category = "Platos Principales"): MenuItem => ({ id: name, name, description: null, price: 3500, category });
const MENU: MenuItem[] = [item("Empanada Humita"), item("Empanada de carne"), item("Grande de muzzarella"), item("Pepsi (Lata)", "Bebidas")];

describe("A) negar un producto que existe", () => {
  it("«No tenemos empanadas de humita» contradice «Empanada Humita»", () => {
    assert.equal(deniesExistingProduct("No tenemos empanadas de humita, pero hacemos de carne.", MENU), "Empanada Humita");
    assert.equal(deniesExistingProduct("Lo siento, no hay humita.", MENU), "Empanada Humita");
    assert.equal(deniesExistingProduct("No trabajamos la empanada de humita 😕", MENU), "Empanada Humita");
  });

  it("no marca lo que de verdad no está ni las frases genéricas", () => {
    assert.equal(deniesExistingProduct("No tenemos pastas, pero tenemos pizzas.", MENU), null);
    assert.equal(deniesExistingProduct("No tenemos sushi.", MENU), null);
    assert.equal(deniesExistingProduct("Hoy no hay promos.", [...MENU, item("PROMO LUNES", "Promos")]), null);
    assert.equal(deniesExistingProduct("Tenemos empanadas de humita y de carne.", MENU), null);
    assert.equal(deniesExistingProduct("No tenemos empanadas de pollo.", MENU), null);
  });

  it("draftIssue descarta el borrador que niega un producto del menú", async () => {
    const repo = { menu: async () => MENU, zones: async () => [] } as unknown as BotRepo;
    const deps = { repo, log: () => {}, appUrl: "https://x.app" } as unknown as TurnDeps;
    const settings = settingsFromConfig({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59" });
    const conv = { id: "c1", phone: "5491155550001", clientId: null, displayName: null, humanTakeover: false };
    assert.equal(await draftIssue("No tenemos empanadas de humita, pero tenemos de carne.", "consulta_menu", conv, deps, settings), "denied_product");
    assert.equal(await draftIssue("Sí, tenemos Empanada Humita a $3.500.", "consulta_menu", conv, deps, settings), null);
  });

  it("turno: si el modelo niega sin consultar, el reintento llama a la herramienta y responde con el producto", async () => {
    const sent: string[] = [];
    const choices: string[] = [];
    const repo: BotRepo = {
      getConversation: async (phone) => ({ id: "c1", phone, clientId: null, displayName: null, humanTakeover: false }),
      history: async () => [{ direction: "in", body: "hola" }, { direction: "out", body: "¡Hola! 👋" }, { direction: "in", body: "tienen empanadas de humita?" }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_portal_recordatorio_horas: 0 }),
      menu: async () => MENU,
      zones: async () => [],
      latestOrder: async () => null,
      setTakeover: async () => {},
      setMarketingOptIn: async () => 1,
      saveOutbound: async (_c, _w, body) => { sent.push(body); },
      saveTranscript: async () => {},
      lastOutboundAt: async () => new Date(),
    };
    let answers = 0;
    const run: TurnDeps["run"] = async (_m, input) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "consulta_menu", confidence: 0.95 }) };
      const msgs = input.messages as { role: string }[];
      if (msgs.some((m) => m.role === "tool")) return { response: "Sí, tenemos Empanada Humita a $3.500." };
      if (answers++ === 0) return { response: "No tenemos empanadas de humita, pero tenemos de carne." };
      choices.push(String((input as { tool_choice?: unknown }).tool_choice ?? "auto"));
      return { tool_calls: [{ name: "get_categoria", arguments: { categoria: "humita" } }] };
    };
    let n = 0;
    const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://x.app", log: () => {} };
    await processTurn({ phone: "5491170000001", text: "tienen empanadas de humita?", wamids: ["w1"], audios: [], receivedAt: 0 }, deps);
    assert.equal(sent.length, 1);
    assert.match(sent[0], /Empanada Humita/);
    assert.doesNotMatch(sent[0], /No tenemos/);
    assert.deepEqual(choices, ["required"]);
  });
});

describe("B) «hola» + pedido concreto se responde en el mismo turno", () => {
  it("openingHasContent: pedido con producto sí; «quiero pedir» a secas no", () => {
    assert.equal(openingHasContent("hola, quiero la promo Baila Ahora"), true);
    assert.equal(openingHasContent("hola quiero una muzza"), true);
    assert.equal(openingHasContent("buenas quiero 2 empanadas"), true);
    assert.equal(openingHasContent("hola quiero pedir"), false);
    assert.equal(openingHasContent("hola quiero hacer un pedido"), false);
    assert.equal(openingHasContent("hola buenas tardes"), false);
    assert.equal(openingHasContent("quiero pedir algo"), false);
  });
});

describe("C) cliente registrado: perfil y dirección corta", () => {
  const PHONE = "5491155550099";
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
    // Como el cliente de prueba de producción: teléfono «+54 9 11 …», phone_digits NULL, unido a la conversación por client_id.
    db.raw.prepare("INSERT INTO clients (id, name, phone, phone_digits, address) VALUES ('cP', 'Nicolas', '+54 9 11 5555 0099', NULL, NULL)").run();
    db.raw.prepare("INSERT INTO wa_conversations (id, client_phone, client_id) VALUES ('w1', ?, 'cP')").run(PHONE);
    db.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc, delivery_address, created_at) VALUES ('o1', 'cP', 'Recibidos', 'x', ?, '2026-11-23T20:00:00.000Z')")
      .run("Army, 5000, Avenida Rivadavia, Caballito, Buenos Aires, Comuna 6, Ciudad Autónoma de Buenos Aires, C1424CER, Argentina — piso 3 dto B");
  });

  it("encuentra al cliente por la conversación aunque phone_digits sea NULL y acorta la dirección", async () => {
    const p = await d1BotRepo(db).customerProfile!(PHONE);
    assert.equal(p?.name, "Nicolas");
    assert.equal(p?.orderCount, 1);
    assert.equal(p?.lastAddress, "Avenida Rivadavia 5000, piso 3 dto B");
  });

  it("un teléfono sin conversación ni phone_digits no recibe datos de otro cliente", async () => {
    assert.equal(await d1BotRepo(db).customerProfile!("5491100000000"), null);
  });

  it("shortAddress: calle y altura (+ piso/dto); lo corto queda igual", () => {
    assert.equal(shortAddress("Army, 5000, Avenida Rivadavia, Caballito, Buenos Aires, Comuna 6, CABA, C1424CER, Argentina — piso 3 dto B"), "Avenida Rivadavia 5000, piso 3 dto B");
    assert.equal(shortAddress("Juramento 1500, Belgrano, Ciudad de Buenos Aires, Argentina"), "Juramento 1500, Belgrano");
    assert.equal(shortAddress("Av. Santa Fe 1234, Palermo"), "Av. Santa Fe 1234, Palermo");
    assert.equal(shortAddress("Belgrano 456"), "Belgrano 456");
    assert.equal(shortAddress("1234, Corrientes, Buenos Aires"), "Corrientes 1234");
  });
});
