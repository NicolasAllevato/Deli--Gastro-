import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { chosenPayment, cleanOptionName, COVERED_PROMPT, errorReply, optionQuestion, pendingOperation, renderQuoteSummary, ORDER_REPLIES } from "../workers/whatsapp-bot/src/orders/flow.ts";
import { namesProducts } from "../workers/whatsapp-bot/src/bot/menu.ts";
import type { OrderFailure, OrderResponse, OrdersClient } from "../workers/whatsapp-bot/src/orders/client.ts";
import type { BotRepo, MenuItem } from "../workers/whatsapp-bot/src/repo/types.ts";
import { outOfZoneReason, quoteDelivery, type DeliveryZone } from "../src/lib/zones.ts";
import { validateLineOptions, buildModifierCatalog } from "../src/lib/order-options.ts";

const PHONE = "5491100000001";
const PID = "11111111-1111-4111-8111-111111111111";
const CAFE = "22222222-2222-4222-8222-222222222222";
const MENU: MenuItem[] = [
  { id: PID, name: "Baila Ahora, Baila Ahora (Gde Muzza + Gaseosa)", description: null, price: 51000, category: "Promos" },
  { id: CAFE, name: "Café Jarrito", description: null, price: 4000, category: "Cafetería" },
  { id: "33333333-3333-4333-8333-333333333333", name: "Medialuna de manteca", description: null, price: 1800, category: "Cafetería" },
];
const BAD_OPTION =
  "Una opción elegida no corresponde a «Baila Ahora, Baila Ahora (Gde Muzza + Gaseosa)». Opciones válidas: Pepsi (Lata), Pepsi Black (Lata), Seven Up, Seven Free, Stella Artois (Lata Zero), Quilmes (Lata Zero 473).";

function harness(quote: OrdersClient["quote"], menu: MenuItem[] = MENU, history: Array<{ direction: "in" | "out"; body: string }> = [{ direction: "in", body: "hola" }], confirm?: OrdersClient["confirm"]) {
  const sent: string[] = [];
  const repo: BotRepo = {
    getConversation: async (phone) => (phone === PHONE ? { id: "c1", phone, clientId: "cl1", displayName: "Ana", humanTakeover: false } : null),
    history: async () => [...history],
    inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
    config: async () => ({ agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59", negocio_nombre: "Deli", bot_orders_enabled: true }),
    menu: async () => menu,
    zones: async () => [],
    latestOrder: async () => null,
    setTakeover: async () => {},
    setMarketingOptIn: async () => 1,
    saveOutbound: async (_c, _w, body) => { sent.push(body); },
    saveTranscript: async () => {},
  };
  const ok = (data: Record<string, unknown>): OrderResponse => ({ ok: true, status: 200, data: { ok: true, ...data } });
  const orders: OrdersClient = {
    quote,
    confirm: confirm ?? (async () => ok({})),
    cancel: async () => ok({}),
    status: async () => ok({ found: false }),
  };
  const deps = (run: TurnDeps["run"]): TurnDeps => ({ repo, run, transcribe: async () => null, send: async () => "out-1", appUrl: "https://dely.opsyn.app", orders, log: () => {} });
  return { sent, deps };
}

const reject = (error: string): OrderFailure => ({ ok: false, kind: "api", status: 400, code: "rejected", error });
const turn = (text: string) => ({ phone: PHONE, text, wamids: ["w2"], audios: [], receivedAt: 0 });
const call = (productId: string) => ({ name: "quote_order", arguments: { items: [{ product_id: productId, qty: 1, options: [{ option_id: 99, qty: 2 }] }], address: "Juramento 1500" } });

/** Modelo falso: ejecuta las herramientas en orden y después contesta cada `finals` (el último se repite). */
function model(intent: string, tools: Array<{ name: string; arguments: unknown }>, finals: string[]) {
  let finalIdx = 0;
  const run = async (_m: string, input: Record<string, unknown>) => {
    if ("response_format" in input) return { response: JSON.stringify({ intent, confidence: 0.95 }) };
    const used = (input.messages as { role: string }[]).filter((m) => m.role === "tool");
    if (used.length < tools.length) return { tool_calls: [tools[used.length]] };
    return { response: finals[Math.min(finalIdx++, finals.length - 1)] };
  };
  return { run };
}

describe("promo con opciones: el error de validación nunca llega crudo al cliente", () => {
  it("el rechazo vuelve al modelo y el modelo pregunta", async () => {
    const h = harness(async () => reject(BAD_OPTION));
    const m = model("pedido_nuevo", [call(PID)], ["¿Qué 2 gaseosas querés para la promo? Pepsi, Pepsi Black, Seven Up, Seven Free."]);
    await processTurn(turn("quiero la promo Baila Ahora para Juramento 1500"), h.deps(m.run));
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0], /¿Qué 2 gaseosas querés/);
    assert.doesNotMatch(h.sent[0], /Una opción elegida|Opciones válidas|\$0/);
  });

  it("si el modelo insiste, la pregunta sale armada en código y sin texto técnico", async () => {
    const h = harness(async () => reject(BAD_OPTION.replace("Seven Up,", "Seven Up ($0),")));
    const m = model("pedido_nuevo", [call(PID), call(PID), call(PID)], ["listo"]);
    await processTurn(turn("quiero la promo Baila Ahora para Juramento 1500"), h.deps(m.run));
    assert.equal(h.sent.length, 1);
    assert.match(h.sent[0], /^¿Qué opciones querés para «Baila Ahora»\? Pepsi \(Lata\), Pepsi Black \(Lata\), Seven Up, Seven Free/);
    assert.doesNotMatch(h.sent[0], /Una opción elegida|Opciones válidas|\$0|no corresponde/);
  });

  it("optionQuestion con el mínimo del grupo", () => {
    const q = optionQuestion("Para «Baila Ahora, X» elegí 2 de «bebidas promo»: Pepsi, Seven Up ($0), Seven Free.");
    assert.equal(q, "¿Cuáles 2 querés para «Baila Ahora»? Pepsi, Seven Up, Seven Free.");
    assert.equal(optionQuestion("Las cantidades de las opciones de «X» tienen que ser enteros mayores a 0."), "¿Qué opciones querés para «X»?");
  });

  it("los nombres de opción salen sin el sufijo «($0)» (servidor y resumen)", () => {
    assert.equal(cleanOptionName("Seven Up ($0)"), "Seven Up");
    assert.equal(cleanOptionName("Pepsi (Lata)"), "Pepsi (Lata)");
    const catalog = buildModifierCatalog({
      groups: [{ fudo_id: 3, name: "bebidas promo", min_qty: 2, max_qty: 2, }],
      options: [{ fudo_id: 16, group_fudo_id: 3, product_fudo_id: 230, name: "Seven Up ($0)", price_cents: 0, position: 0, is_active: 1 }],
      productGroups: [{ product_fudo_id: 88, group_fudo_id: 3 }],
    });
    const out = validateLineOptions({ productName: "Baila", productFudoId: 88, isDocena: false, docenaUnits: 0, options: [{ option_id: 1, qty: 1 }] }, catalog);
    assert.ok(!out.ok);
    assert.doesNotMatch(out.message, /\$0/);
    const summary = renderQuoteSummary({ lines: [{ name: "Baila", qty: 1, price: 100, options: [{ name: "Seven Up ($0)", qty: 2 }] }], subtotal: 100, delivery_fee: 0, total: 100, resolved_address: "Juramento 1500" }, "Juramento 1500");
    assert.doesNotMatch(summary ?? "", /\(\$0\)/);
  });
});

describe("pedido con productos nombrados: nunca la plantilla «Decime qué querés pedir»", () => {
  const imita = "Resumen de tu pedido: 2 cafés y 4 medialunas. Respondé SÍ para confirmar.";

  it("namesProducts reconoce productos y no el «quiero pedir» genérico", () => {
    assert.ok(namesProducts("2 cafés con leche y 4 medialunas para Juramento 1500", MENU));
    assert.ok(!namesProducts("quiero pedir algo", MENU));
  });

  it("si el modelo insiste con una plantilla, sale la pregunta por cada producto", async () => {
    const h = harness(async () => reject("x"));
    const m = model("pedido_nuevo", [], [imita, imita, imita]);
    await processTurn(turn("2 cafés con leche y 4 medialunas para Juramento 1500"), h.deps(m.run));
    assert.equal(h.sent.length, 1);
    assert.doesNotMatch(h.sent[0], /Decime qué querés pedir/);
    assert.match(h.sent[0], /cuál querés/);
  });

  it("sin productos nombrados queda la plantilla de siempre", async () => {
    const h = harness(async () => reject("x"));
    const m = model("pedido_nuevo", [], [imita, imita, imita]);
    await processTurn(turn("quiero pedir"), h.deps(m.run));
    assert.equal(h.sent[0], ORDER_REPLIES.startOver);
  });
});

describe("zonas: recargo y fuera de cobertura", () => {
  const LOCAL = { lat: -34.6, lng: -58.39 };
  const circle = (id: string, km: number, fee: number, sort: number): DeliveryZone => ({ id, name: id, fee, min_order: 0, sort_order: sort, is_active: true, shape: { type: "circle", lat: LOCAL.lat, lng: LOCAL.lng, radius_km: km } });
  const zones = [circle("Radio 5 km", 5, 0, 1), circle("Radio 7 km", 7, 1500, 2), circle("Radio 10 km", 10, 3000, 3)];
  const opts = { local: LOCAL, radiusKm: 5, costPerKm: 100 };
  const at = (km: number) => ({ lat: LOCAL.lat + km / 111.19, lng: LOCAL.lng });

  it("dentro de la zona gratis no hay aviso; en una con recargo sí", () => {
    const free = quoteDelivery(at(3), zones, opts);
    assert.ok(free.covered && free.fee === 0 && !free.freeZoneAvailable);
    const paid = quoteDelivery(at(6), zones, opts);
    assert.ok(paid.covered && paid.fee === 1500 && paid.freeZoneAvailable);
  });

  it("sin zona gratis activa no hay aviso", () => {
    const q = quoteDelivery(at(6), zones.slice(1), opts);
    assert.ok(q.covered && !q.freeZoneAvailable);
  });

  it("fuera de todas las zonas: mensaje fijo con el radio máximo", () => {
    const q = quoteDelivery(at(10.9), zones, opts);
    assert.ok(!q.covered);
    assert.equal(q.reason, "Por ahora no llegamos a esa dirección: entregamos hasta 10 km del local.");
    assert.equal(outOfZoneReason([{ ...zones[0], shape: { type: "polygon", points: [] } }]), "Por ahora no llegamos a esa dirección.");
  });

  it("el bot manda el motivo del servidor tal cual, sin «armamos de nuevo» ni «incorrecta»", () => {
    const failure: OrderFailure = { ok: false, kind: "api", status: 422, code: "out_of_zone", error: outOfZoneReason(zones) };
    assert.equal(errorReply(failure, { appUrl: "x" }), "Por ahora no llegamos a esa dirección: entregamos hasta 10 km del local.");
  });

  it("el resumen avisa el recargo solo con el dato del servidor", () => {
    const base = { lines: [{ name: "Muzza", qty: 1, price: 9000 }], subtotal: 9000, delivery_fee: 1500, total: 10500, resolved_address: "Juramento 1500" };
    assert.match(renderQuoteSummary({ ...base, free_zone_available: true }, "Juramento 1500") ?? "", /Tu dirección está fuera de la zona de envío gratis: tiene un recargo de envío de \$1\.500\./);
    assert.doesNotMatch(renderQuoteSummary(base, "Juramento 1500") ?? "", /recargo/);
    assert.doesNotMatch(renderQuoteSummary({ ...base, delivery_fee: 0, total: 9000, free_zone_available: true }, "x") ?? "", /recargo/);
  });
});

describe("saldo a favor que cubre todo: sin pregunta de forma de pago", () => {
  const covered = renderQuoteSummary({ lines: [{ name: "Muzza", qty: 1, price: 9000 }], subtotal: 9000, delivery_fee: 0, credit_applied: 9000, total: 0, resolved_address: "Juramento 1500" }, "Juramento 1500") ?? "";

  it("el resumen cierra con la pregunta del saldo y no con la de pago", () => {
    assert.match(covered, /\*Total: \$0\*/);
    assert.ok(covered.endsWith(COVERED_PROMPT));
    assert.equal(COVERED_PROMPT, "Tu saldo a favor cubre todo el pedido. ¿Lo confirmo? Respondé SÍ.");
    assert.doesNotMatch(covered, /efectivo o Mercado Pago/);
    assert.equal(pendingOperation(covered), "confirm");
    assert.equal(chosenPayment(covered), "Efectivo");
  });

  it("con total distinto de $0 o sin saldo se pregunta la forma de pago de siempre", () => {
    const base = { lines: [{ name: "Muzza", qty: 1, price: 9000 }], subtotal: 9000, delivery_fee: 0, resolved_address: "Juramento 1500" };
    assert.match(renderQuoteSummary({ ...base, credit_applied: 5000, total: 4000 }, "x") ?? "", /efectivo o Mercado Pago/);
    assert.match(renderQuoteSummary({ ...base, credit_applied: 0, total: 9000 }, "x") ?? "", /efectivo o Mercado Pago/);
  });

  it("el SÍ confirma directo, sin pedir medio de pago, y avisa que quedó pagado con el saldo", async () => {
    const bodies: unknown[] = [];
    const h = harness(
      async () => reject("x"), MENU,
      [{ direction: "out", body: covered }, { direction: "in", body: "Sí" }],
      async (body) => { bodies.push(body); return { ok: true, status: 200, data: { ok: true, order_code: "#AB12CD34", total: 0, payment_method: "Efectivo" } }; },
    );
    const m = model("saludo", [], ["x"]);
    assert.equal(await processTurn(turn("Sí"), h.deps(m.run)), "answered");
    assert.equal(bodies.length, 1);
    assert.match(h.sent[0], /#AB12CD34/);
    assert.match(h.sent[0], /pagado con tu saldo a favor/);
    assert.doesNotMatch(h.sent[0], /efectivo al recibir|\$0/);
  });
});
