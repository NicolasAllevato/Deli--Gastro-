/** Cliente registrado: nombre y UNA dirección (la última) que arma el código; cliente nuevo = flujo de siempre. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb } from "./helpers/sqlite-d1.ts";
import { d1BotRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { customerProfileLines, offerSavedAddress, profileAddressUnconfirmed, savedAddressAcceptedHint, savedAddressQuestion } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import type { BotRepo, CustomerProfile } from "../workers/whatsapp-bot/src/repo/types.ts";
import type { OrdersClient } from "../workers/whatsapp-bot/src/orders/client.ts";

type Db = ReturnType<typeof createTestDb>;
const PHONE = "5491155550001";

describe("dirección del cliente registrado (repo)", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    db.raw.prepare("INSERT INTO clients (id, name, phone, phone_digits, address) VALUES ('cA', 'Martina Gómez', ?, '1155550001', 'Ficha 1')").run(PHONE);
  });

  it("con varios pedidos vale SOLO la dirección del más reciente (no cancelado)", async () => {
    const o = db.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc, delivery_address, created_at) VALUES (?, 'cA', ?, 'x', ?, ?)");
    o.run("o1", "Finalizados", "Av. Corrientes 1234", "2026-11-01T20:00:00.000Z");
    o.run("o2", "Finalizados", "Belgrano 456", "2026-11-10T20:00:00.000Z");
    o.run("o3", "Cancelado", "Otra 999", "2026-11-12T20:00:00.000Z");
    const p = await d1BotRepo(db).customerProfile!(PHONE);
    assert.equal(p?.lastAddress, "Belgrano 456");
  });

  it("registrado sin pedidos: usa la dirección de su ficha", async () => {
    const p = await d1BotRepo(db).customerProfile!(PHONE);
    assert.deepEqual(p, { name: "Martina Gómez", orderCount: 0, topProducts: [], lastAddress: "Ficha 1" });
  });

  it("si da otra dirección y pide, esa pasa a ser la última", async () => {
    const o = db.raw.prepare("INSERT INTO orders (id, client_id, status, items_desc, delivery_address, created_at) VALUES (?, 'cA', 'Recibidos', 'x', ?, ?)");
    o.run("o1", "Belgrano 456", "2026-11-10T20:00:00.000Z");
    o.run("o2", "Juramento 1500", "2026-11-20T20:00:00.000Z");
    assert.equal((await d1BotRepo(db).customerProfile!(PHONE))?.lastAddress, "Juramento 1500");
  });

  it("cliente nuevo (sin ficha ni pedidos): sin perfil, se pide la dirección como siempre", async () => {
    assert.equal(await d1BotRepo(db).customerProfile!("5491199990000"), null);
  });
});

describe("prompt y pregunta fija", () => {
  const profile = (over: Partial<CustomerProfile> = {}): CustomerProfile => ({ name: "Martina", orderCount: 0, topProducts: [], lastAddress: "Belgrano 456", ...over });

  it("registrado con dirección y sin pedidos: saluda por nombre y ofrece solo esa dirección", () => {
    const lines = customerProfileLines(profile()).join("\n");
    assert.match(lines, /saludalo por su nombre/);
    assert.match(lines, /«¿Te lo enviamos a Belgrano 456\?»/);
    assert.match(lines, /ÚNICA/);
    assert.doesNotMatch(lines, /Ya hizo/);
  });

  it("sin dirección ni pedidos no agrega nada", () => {
    assert.deepEqual(customerProfileLines(profile({ lastAddress: null })), []);
  });

  it("la pregunta fija se acepta con un «sí» y no se cotiza sin él", () => {
    const q = savedAddressQuestion("Belgrano 456");
    assert.equal(q, "¿Te lo enviamos a Belgrano 456?");
    assert.equal(profileAddressUnconfirmed("Belgrano 456", "Belgrano 456", [], null, "2 muzzas"), true);
    assert.equal(profileAddressUnconfirmed("Belgrano 456", "Belgrano 456", [], q, "sí dale"), false);
  });
});

describe("savedAddressAcceptedHint", () => {
  const q = "¿Te lo enviamos a Belgrano 456?";
  it("tras la oferta y un «sí» manda cotizar ya con esa dirección", () => {
    assert.match(String(savedAddressAcceptedHint("sí dale", q, "Belgrano 456")), /quote_order YA/);
  });
  it("sin oferta previa, sin «sí» o sin dirección no hay pista", () => {
    assert.equal(savedAddressAcceptedHint("sí", "¿Algo más?", "Belgrano 456"), null);
    assert.equal(savedAddressAcceptedHint("no, a otra", q, "Belgrano 456"), null);
    assert.equal(savedAddressAcceptedHint("sí", q, null), null);
  });
});

describe("offerSavedAddress", () => {
  const saved = "Belgrano 456";
  it("reemplaza la pregunta por la dirección con la fija", () => {
    assert.equal(offerSavedAddress("¿A qué dirección te lo enviamos?", saved, [], null, "quiero 2 muzzas"), "¿Te lo enviamos a Belgrano 456?");
    assert.equal(
      offerSavedAddress("Dale, 2 muzzas. ¿Me pasás la dirección de entrega?", saved, [], null, "quiero 2 muzzas"),
      "Dale, 2 muzzas.\n¿Te lo enviamos a Belgrano 456?",
    );
  });
  it("no toca nada si el cliente ya dio una dirección con altura", () => {
    assert.equal(offerSavedAddress("¿Cuál es la dirección completa?", saved, [], null, "quiero 2 muzzas a Juramento 1500"), null);
    assert.equal(offerSavedAddress("¿Cuál es la dirección?", saved, ["a Av. Santa Fe 1234"], null, "y una coca"), null);
  });
  it("no pisa la pregunta por una altura o un piso que falta", () => {
    assert.equal(offerSavedAddress("¿Me pasás la altura de la dirección?", saved, [], null, "a Santa Fe, Palermo"), null);
  });
  it("no repite la oferta en bucle ni toca borradores sin pregunta de dirección", () => {
    assert.equal(offerSavedAddress("¿A qué dirección?", saved, [], "¿Te lo enviamos a Belgrano 456?", "no"), null);
    assert.equal(offerSavedAddress("Tenemos Muzza a $9.000", saved, [], null, "qué pizzas tienen"), null);
    assert.equal(offerSavedAddress("¿A qué dirección?", null, [], null, "x"), null);
  });
});

describe("turno: cliente registrado vs nuevo", () => {
  function setup(profile: CustomerProfile | null, draft: string | ((system: string) => string)) {
    const sent: string[] = [];
    const repo: BotRepo = {
      getConversation: async (phone) => ({ id: "c1", phone, clientId: profile ? "cl1" : null, displayName: profile?.name ?? null, humanTakeover: false }),
      history: async () => [{ direction: "in", body: "hola" }, { direction: "out", body: "¡Hola! ¿Qué querés pedir?" }, { direction: "in", body: "quiero 2 muzzas" }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_orders_enabled: true }),
      menu: async () => [{ id: "p1", name: "Muzza", description: null, price: 9000, category: "Pizzas" }],
      zones: async () => [],
      latestOrder: async () => null,
      customerProfile: async () => profile,
      setTakeover: async () => {},
      setMarketingOptIn: async () => 1,
      saveOutbound: async () => {},
      saveTranscript: async () => {},
      lastOutboundAt: async () => new Date(),
    };
    const run = async (_m: string, input: Record<string, unknown>) =>
      "response_format" in input ? { response: JSON.stringify({ intent: "pedido_nuevo", confidence: 0.95 }) } : { response: typeof draft === "string" ? draft : draft(String((input.messages as { content?: string }[])[0]?.content ?? "")) };
    let n = 0;
    const deps: TurnDeps = {
      repo, run, transcribe: async () => null, send: async (_p, t) => { sent.push(t); return `o${++n}`; }, appUrl: "https://dely.opsyn.app",
      orders: { status: async () => ({ ok: true, status: 200, data: { ok: true, found: false } }) } as unknown as OrdersClient, log: () => {},
    };
    return { deps, sent };
  }
  const turn = { phone: PHONE, text: "quiero 2 muzzas", wamids: ["w1"], audios: [], receivedAt: 0 };

  it("registrado: la pregunta por la dirección sale fija con su última dirección", async () => {
    const { deps, sent } = setup({ name: "Martina", orderCount: 1, topProducts: [], lastAddress: "Belgrano 456" }, "¡Dale! ¿A qué dirección te lo enviamos?");
    await processTurn(turn, deps);
    assert.ok(sent.some((t) => t.includes("¿Te lo enviamos a Belgrano 456?")), sent.join(" | "));
    assert.ok(!sent.some((t) => /qué dirección/i.test(t)));
  });

  it("registrado que ya dio su dirección: no se le ofrece la guardada (reintento con la corrección)", async () => {
    const { deps, sent } = setup({ name: "Martina", orderCount: 1, topProducts: [], lastAddress: "Belgrano 456" },
      (system) => (system.includes("CORRECCIÓN") ? "Dale, ya te armo el pedido." : "¿Te lo enviamos a Belgrano 456?"));
    await processTurn({ ...turn, text: "quiero 2 muzzas a Av. Santa Fe 1234" }, deps);
    assert.ok(!sent.some((t) => t.includes("Te lo enviamos a")), sent.join(" | "));
  });

  it("nuevo: se le pide la dirección como siempre", async () => {
    const { deps, sent } = setup(null, "¡Dale! ¿A qué dirección te lo enviamos?");
    await processTurn(turn, deps);
    assert.ok(sent.some((t) => /qué dirección/i.test(t)), sent.join(" | "));
    assert.ok(!sent.some((t) => t.includes("Te lo enviamos a")));
  });
});
