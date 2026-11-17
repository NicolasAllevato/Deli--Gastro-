/** Base de conocimiento, etapas 2 (perfil del cliente habitual) y 3 (aprendizaje nocturno desde conversaciones reales). */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { buildResponderPrompt, customerProfileLines, profileAddressUnconfirmed } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { toolsFor, UNCONFIRMED_ADDRESS } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { newOrderState, type OrderTurn } from "../workers/whatsapp-bot/src/orders/flow.ts";
import type { OrdersClient } from "../workers/whatsapp-bot/src/orders/client.ts";
import { maskTranscriptPii } from "../src/lib/whatsapp/privacy.ts";
import { runNightlyLearning, type JudgeFn } from "../workers/whatsapp-bot/src/learning/nightly.ts";
import { listErrores, listSugerencias } from "../src/lib/data/kb-aprendizaje.ts";
import { parseRealVerdict } from "../src/lib/data/kb-juez.ts";
import { systemActor } from "../src/lib/data/actor.ts";

type Db = ReturnType<typeof createTestDb>;
const PHONE_A = "5491155550001";
const PHONE_B = "5491155550002";
const NOW = new Date("2026-11-17T06:00:00.000Z");
const RECENT = "2026-11-16T22:00:00.000Z";

function seedProfiles(db: Db) {
  const r = db.raw;
  r.prepare("INSERT INTO clients (id, name, phone, phone_digits) VALUES (?, ?, ?, ?)").run("cA", "Martina Gómez", PHONE_A, "1155550001");
  r.prepare("INSERT INTO clients (id, name, phone, phone_digits) VALUES (?, ?, ?, ?)").run("cB", "Ramiro Paz", PHONE_B, "1155550002");
  const o = r.prepare("INSERT INTO orders (id, client_id, status, items_desc, delivery_address, created_at) VALUES (?, ?, ?, 'x', ?, ?)");
  o.run("o1", "cA", "Finalizados", "Av. Corrientes 1234", "2026-11-01T20:00:00.000Z");
  o.run("o2", "cA", "Finalizados", "Belgrano 456", "2026-11-10T20:00:00.000Z");
  o.run("o3", "cA", "Cancelado", "Otra 999", "2026-11-12T20:00:00.000Z");
  o.run("o4", "cB", "Finalizados", "Mitre 77", "2026-11-11T20:00:00.000Z");
  const i = r.prepare("INSERT INTO order_items (id, order_id, name, qty, unit_price_cents) VALUES (?, ?, ?, ?, 0)");
  i.run("i1", "o1", "Muzza", 2);
  i.run("i2", "o2", "Muzza", 1);
  i.run("i3", "o2", "Fugazzeta", 2);
  i.run("i4", "o1", "Coca", 1);
  i.run("i5", "o2", "Empanada", 1);
  i.run("i6", "o3", "Napo", 9); // cancelado: no cuenta
  i.run("i7", "o4", "Calabresa", 3); // de otro cliente
}

describe("etapa 2: perfil del cliente habitual", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    seedProfiles(db);
  });

  it("deriva nombre, pedidos, top 3 y última dirección del mismo teléfono", async () => {
    const p = await d1BotRepo(db).customerProfile!(PHONE_A);
    assert.deepEqual(p, { name: "Martina Gómez", orderCount: 2, topProducts: ["Muzza", "Fugazzeta", "Coca"], lastAddress: "Belgrano 456" });
  });

  it("aislamiento: cada teléfono ve solo lo suyo; un teléfono nuevo no tiene perfil", async () => {
    const b = await d1BotRepo(db).customerProfile!(PHONE_B);
    assert.deepEqual(b?.topProducts, ["Calabresa"]);
    assert.equal(b?.lastAddress, "Mitre 77");
    assert.equal(await d1BotRepo(db).customerProfile!("5491199990000"), null);
    const promptA = buildResponderPrompt(settingsFromConfig({}), "saludo", null, false, [], [], await d1BotRepo(db).customerProfile!(PHONE_A));
    assert.match(promptA, /Martina/);
    assert.doesNotMatch(promptA, /Ramiro|Calabresa|Mitre/);
  });

  it("con perfil: saluda por nombre, ofrece lo de siempre y pregunta por la misma dirección", () => {
    const lines = customerProfileLines({ name: "Martina", orderCount: 3, topProducts: ["Muzza"], lastAddress: "Belgrano 456" }).join("\n");
    assert.match(lines, /Cliente habitual/);
    assert.match(lines, /lo de siempre/);
    assert.match(lines, /misma dirección \(Belgrano 456\)/);
    assert.match(lines, /esperá que confirme/);
  });

  it("sin perfil (cliente nuevo) el prompt no cambia", () => {
    const s = settingsFromConfig({});
    assert.equal(buildResponderPrompt(s, "saludo", null, false, [], [], null), buildResponderPrompt(s, "saludo", null, false));
    assert.deepEqual(customerProfileLines({ name: "X", orderCount: 0, topProducts: [], lastAddress: null }), []);
  });

  it("la dirección guardada no se usa para cotizar sin confirmación", () => {
    const saved = "Belgrano 456";
    assert.equal(profileAddressUnconfirmed("Belgrano 456", saved, ["hola, quiero 2 muzzas"], null, "lo de siempre"), true);
    // La escribió el cliente, o respondió que sí a la pregunta: se puede cotizar.
    assert.equal(profileAddressUnconfirmed("Belgrano 456", saved, [], null, "mandalo a belgrano 456"), false);
    assert.equal(profileAddressUnconfirmed("Belgrano 456", saved, [], "¿Te lo mandamos a la misma dirección (Belgrano 456)?", "sí dale"), false);
    // Otra dirección no se frena; sin perfil tampoco.
    assert.equal(profileAddressUnconfirmed("Mitre 77", saved, [], null, "a Mitre 77"), false);
    assert.equal(profileAddressUnconfirmed("Belgrano 456", null, [], null, "x"), false);
  });

  it("quote_order rechaza la dirección del perfil sin confirmar y no llama a la app", async () => {
    let quoted = 0;
    const orders = { quote: async () => { quoted += 1; return { ok: true }; } } as unknown as OrdersClient;
    const order: OrderTurn = { client: orders, phone: PHONE_A, conversationId: "conv", wamid: "w", state: newOrderState() } as unknown as OrderTurn;
    const conv = { id: "conv", phone: PHONE_A, clientId: "cA", displayName: "Martina", humanTakeover: false };
    const guard = (a: string) => profileAddressUnconfirmed(a, "Belgrano 456", [], null, "lo de siempre");
    const tool = toolsFor("pedido_nuevo", d1BotRepo(db), conv, settingsFromConfig({}), Date.now, order, guard).find((t) => t.name === "quote_order")!;
    const out = await tool.run({ items: [{ product_id: "p", qty: 1 }], address: "Belgrano 456" });
    assert.deepEqual(out, UNCONFIRMED_ADDRESS);
    assert.equal(quoted, 0);
  });
});

describe("etapa 3: enmascarado antes de mandar a OpenAI", () => {
  it("tapa teléfono, email, DNI, tarjeta, CBU, direcciones y nombres", () => {
    const raw = [
      "Hola soy Martina, mi cel es +54 9 11 5555-0001 y mi mail martu@gmail.com",
      "DNI 30.123.456, tarjeta 4111 1111 1111 1111, CBU 0170099220000067797370",
      "mandalo a Av. Corrientes 1234 piso 3 dpto B porfa",
      "dirección: belgrano 456",
      "Gracias Martín! Saludos a Gómez",
    ].join("\n");
    const out = maskTranscriptPii(raw, { names: ["Martín Gómez"], addresses: ["Belgrano 456"] });
    for (const leak of ["Martina", "5555", "martu@", "30.123.456", "4111", "0170099220000067797370", "Corrientes", "1234", "elgrano 456", "Martín", "Gómez"]) {
      assert.ok(!out.includes(leak), `filtró ${leak}: ${out}`);
    }
    assert.match(out, /\[telefono\]/);
    assert.match(out, /\[email\]/);
    assert.match(out, /\[dni\]/);
    assert.match(out, /\[tarjeta\]/);
    assert.match(out, /\[cbu\]/);
    assert.match(out, /\[direccion\]/);
    assert.match(out, /\[nombre\]/);
  });

  it("no rompe un mensaje sin datos personales ni los precios", () => {
    const t = "quiero 2 muzza y una coca, cuánto sale? Total: $14.500";
    assert.equal(maskTranscriptPii(t), t);
  });
});

function seedConversations(db: Db, count: number) {
  const r = db.raw;
  r.prepare("INSERT INTO clients (id, name, phone, phone_digits, address) VALUES ('cA', 'Martina Gómez', ?, '1155550001', 'Belgrano 456')").run(PHONE_A);
  for (let n = 0; n < count; n++) {
    const id = `conv${n}`;
    r.prepare("INSERT INTO wa_conversations (id, client_phone, client_id, contact_name, last_inbound_at) VALUES (?, ?, ?, ?, ?)").run(id, `54911000000${n}`, n === 0 ? "cA" : null, "Martina", RECENT);
    r.prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body, created_at) VALUES (?, ?, ?, 'in', 'text', ?, ?)")
      .run(`m${n}a`, id, `w${n}a`, "Hola soy Martina, una napo a Belgrano 456, mi cel 1155550001", RECENT);
    r.prepare("INSERT INTO wa_messages (id, conversation_id, wamid, direction, type, body, created_at) VALUES (?, ?, ?, 'out', 'text', ?, ?)")
      .run(`m${n}b`, id, `w${n}b`, "No entiendo", RECENT);
  }
}

const VERDICT = JSON.stringify({
  resuelto: false, derivo: false, invento_precios: false, empatia: 2,
  fallas: [{ tipo: "no_entendio", mensaje_cliente: "una napo a Belgrano 456", respuesta_mala: "No entiendo", motivo: "No entendió napo", correccion: "Napo es la pizza napolitana: interpretalo.", causa: "bot" }],
  sugerencias: [{ categoria: "vocabulario", tema: "napo", contenido: "Pizza napolitana", evidencia: "una napo, soy Martina" }],
});

function fakeJudge(sent: string[], tokens = 1000): JudgeFn {
  return async (_system, user) => {
    sent.push(user);
    return { content: VERDICT, tokens };
  };
}

describe("etapa 3: análisis nocturno", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
  });
  const silent = () => {};

  it("enmascara lo que manda, guarda pendientes con origen conversación y deduplica sumando veces", async () => {
    seedConversations(db, 3);
    const sent: string[] = [];
    const s = await runNightlyLearning({ db, judge: fakeJudge(sent), now: NOW, log: silent });
    assert.equal(s.analizadas, 3);
    for (const u of sent) assert.ok(!/Martina|Belgrano 456|1155550001/.test(u), u);
    const actor = systemActor("test");
    const errores = await listErrores(db, actor);
    const sugerencias = await listSugerencias(db, actor);
    assert.equal(errores.length, 1);
    assert.equal(errores[0].veces, 3);
    assert.equal(errores[0].origen, "conversacion");
    assert.equal(errores[0].estado, "pendiente");
    assert.ok(!/Belgrano 456/.test(errores[0].mensaje_cliente));
    assert.equal(sugerencias.length, 1);
    assert.equal(sugerencias[0].categoria, "vocabulario");
    assert.equal(sugerencias[0].origen, "conversacion");
    assert.equal(sugerencias[0].veces, 3);
    assert.ok(!/Martina/.test(sugerencias[0].evidencia));
  });

  it("idempotencia: la segunda corrida del mismo día no vuelve a analizar", async () => {
    seedConversations(db, 2);
    const sent: string[] = [];
    await runNightlyLearning({ db, judge: fakeJudge(sent), now: NOW, log: silent });
    const again = await runNightlyLearning({ db, judge: fakeJudge(sent), now: NOW, log: silent });
    assert.equal(again.analizadas, 0);
    assert.equal(sent.length, 2);
    assert.equal((await listErrores(db, systemActor("t")))[0].veces, 2);
  });

  it("respeta el tope de conversaciones y el de tokens", async () => {
    seedConversations(db, 5);
    const sent: string[] = [];
    const s = await runNightlyLearning({ db, judge: fakeJudge(sent), now: NOW, log: silent, limits: { maxConversations: 3 } });
    assert.equal(s.analizadas, 3);
    const sent2: string[] = [];
    const db2 = createTestDb();
    seedConversations(db2, 5);
    const t = await runNightlyLearning({ db: db2, judge: fakeJudge(sent2, 600), now: NOW, log: silent, limits: { maxTokens: 1000 } });
    assert.equal(t.analizadas, 2);
    assert.equal(t.topeAlcanzado, true);
  });

  it("sin OPENAI_API_KEY no hace nada y loguea sin datos personales", async () => {
    seedConversations(db, 1);
    const logs: string[] = [];
    const s = await runNightlyLearning({ db, judge: null, now: NOW, log: (m, d) => logs.push(`${m} ${JSON.stringify(d ?? "")}`) });
    assert.equal(s.skipped, "sin_openai");
    assert.equal(logs.length, 1);
    assert.ok(!/Martina|1155550001|Belgrano/.test(logs.join()));
    assert.equal((await listErrores(db, systemActor("t"))).length, 0);
  });

  it("un error de red no marca la conversación (se reintenta) y el log final no tiene PII", async () => {
    seedConversations(db, 1);
    const logs: string[] = [];
    const s = await runNightlyLearning({ db, judge: async () => { throw new Error("red caída"); }, now: NOW, log: (m, d) => logs.push(`${m} ${JSON.stringify(d)}`) });
    assert.equal(s.errores, 1);
    assert.ok(!/Martina|1155550001|Belgrano/.test(logs.join()));
    const ok = await runNightlyLearning({ db, judge: fakeJudge([]), now: NOW, log: silent });
    assert.equal(ok.analizadas, 1);
  });

  it("el parser descarta fallas que no son del bot", () => {
    const v = parseRealVerdict(JSON.stringify({ resuelto: true, derivo: false, invento_precios: false, empatia: 4, fallas: [{ tipo: "otro", mensaje_cliente: "x", motivo: "y", correccion: "z", causa: "cliente" }] }));
    assert.deepEqual(v?.fallas, []);
    assert.equal(parseRealVerdict("nada"), null);
  });
});
