import { test } from "node:test";
import assert from "node:assert/strict";
import { alcoholFilter, cartaCategoryForModel, formatCartaSeccion, isAlcoholic } from "../workers/whatsapp-bot/src/bot/menu.ts";

type Seccion = Parameters<typeof formatCartaSeccion>[0];
const p = (id: string, price: number) => ({ id, price });

const bebidas = {
  titulo: "Bebidas", estilo: "lista", columnas: [], items: [
    { nombre: "Agua con/sin gas", nota: null, productos: [p("a", 4000)] },
    { nombre: "Pepsi Chica", nota: null, productos: [p("b", 4000)] },
    { nombre: "Andes - lata", nota: null, productos: [p("c", 6000)] },
    { nombre: "Fernet", nota: null, productos: [p("d", 9000)] },
    { nombre: "Nicasia", nota: null, productos: [p("e", 17000)] },
  ],
} as unknown as Seccion;

const empanadas = {
  titulo: "Empanadas", estilo: "gustos", columnas: [], items: [
    { nombre: "Carne Suave", nota: null, productos: [p("x", 3500)] },
    { nombre: "Pollo", nota: null, productos: [p("y", 3500)] },
  ],
} as unknown as Seccion;

const carta = [empanadas, bebidas];
const textos = (r: Record<string, unknown> | null) => ((r?.secciones ?? []) as { texto: string }[]).map((s) => s.texto).join("\n");

test("empanadas: el precio va una sola vez y los gustos en lista", () => {
  const t = formatCartaSeccion(empanadas);
  assert.equal(t.match(/\$3\.500/g)?.length, 1);
  assert.match(t, /• Carne Suave\n• Pollo/);
});

test("alcoholFilter reconoce sin y con alcohol", () => {
  assert.equal(alcoholFilter("bebidas sin alcohol"), "sin");
  assert.equal(alcoholFilter("gaseosas"), "sin");
  assert.equal(alcoholFilter("tenés cerveza?"), "con");
  assert.equal(alcoholFilter("bebidas"), null);
});

test("isAlcoholic detecta cervezas, fernet y vino", () => {
  assert.ok(isAlcoholic("Andes - lata"));
  assert.ok(isAlcoholic("Fernet"));
  assert.ok(isAlcoholic("Nicasia"));
  assert.ok(!isAlcoholic("Pepsi Chica"));
  assert.ok(!isAlcoholic("Agua con/sin gas"));
});

test("bebidas sin alcohol no incluye cervezas ni fernet", () => {
  const t = textos(cartaCategoryForModel(carta, "bebidas sin alcohol", false));
  assert.match(t, /Pepsi/);
  assert.match(t, /Agua/);
  assert.doesNotMatch(t, /Andes|Fernet|Nicasia/);
});

test("cervezas trae solo bebidas con alcohol", () => {
  const t = textos(cartaCategoryForModel(carta, "cervezas", false));
  assert.match(t, /Andes/);
  assert.doesNotMatch(t, /Pepsi|Agua/);
});

test("bebidas sin filtro trae todas", () => {
  const t = textos(cartaCategoryForModel(carta, "bebidas", false));
  assert.match(t, /Pepsi/);
  assert.match(t, /Fernet/);
});

import { createOrdersClient } from "../workers/whatsapp-bot/src/orders/client.ts";

test("cliente de pedidos: no usa redirect 'error' (Workers no lo soporta) y no sigue redirecciones", async () => {
  const modes: unknown[] = [];
  const fetchImpl = (async (_url: string, init?: RequestInit) => {
    modes.push(init?.redirect);
    return new Response(null, { status: 302, headers: { location: "https://otro" } });
  }) as unknown as typeof fetch;
  const client = createOrdersClient({ baseUrl: "https://app.test", secret: "x".repeat(40), fetchImpl, sleep: async () => {} });
  const r = await client.status({ conversationId: "c", inboundWamid: "w" });
  assert.equal(r.ok, false);
  assert.deepEqual(modes, ["manual"]);
});

import { renderQuoteSummary, shortAddress } from "../workers/whatsapp-bot/src/orders/flow.ts";

test("dirección corta: calle altura, piso/depto, barrio (sin lugar, comuna, CP ni país)", () => {
  const geo = "Army, 5000, Avenida Rivadavia, Caballito, Buenos Aires, Comuna 6, Ciudad Autónoma de Buenos Aires, C1424CER, Argentina";
  assert.equal(shortAddress(geo, "Av Rivadavia 5000 piso 3 dto B"), "Av. Rivadavia 5000, piso 3 dto B, Caballito");
  assert.equal(shortAddress(geo, "Av Rivadavia 5000"), "Av. Rivadavia 5000, Caballito");
  assert.equal(shortAddress("Belgrano 123", "Belgrano 123"), "Belgrano 123");
});

test("dirección corta: si el geocoder devuelve la calle sin altura, no toma «Comuna 14» como calle y usa lo que escribió el cliente", () => {
  const geo = "Palermo, Avenida Santa Fe, Palermo Pacífico, Palermo, Buenos Aires, Comuna 14, Ciudad Autónoma de Buenos Aires, C1425BHV, Argentina";
  assert.equal(shortAddress(geo, "Av. Santa Fe 1234, Palermo"), "Av. Santa Fe 1234, Palermo");
  assert.doesNotMatch(shortAddress(geo, "Av. Santa Fe 1234, Palermo"), /Comuna/);
  // Sin lo que escribió el cliente tampoco se muestra la comuna como calle: se cae al texto del geocoder, truncado.
  assert.doesNotMatch(shortAddress(geo).split(",")[0] ?? "", /^Comuna/);
});

test("dirección corta: piso y depto salen sin comas de más aunque el cliente los escriba con coma", () => {
  const geo = "1234, Avenida Santa Fe, Palermo, Buenos Aires, Comuna 14, Ciudad Autónoma de Buenos Aires, C1425BHV, Argentina";
  assert.equal(shortAddress(geo, "Av. Santa Fe 1234 piso 8 depto A, Palermo"), "Av. Santa Fe 1234, piso 8 depto A, Palermo");
  assert.equal(shortAddress(geo, "Av. Santa Fe 1234, piso 8, depto A, Palermo"), "Av. Santa Fe 1234, piso 8 depto A, Palermo");
  assert.doesNotMatch(shortAddress(geo, "Av. Santa Fe 1234 piso 8 depto A, Palermo"), /,,|, ,/);
});

import { hasStreetNumber } from "../workers/whatsapp-bot/src/orders/flow.ts";

test("hasStreetNumber: la calle necesita altura (o «s/n»); piso y depto no la reemplazan", () => {
  assert.equal(hasStreetNumber("Av. Santa Fe 1234, Palermo"), true);
  assert.equal(hasStreetNumber("Juramento 1500 timbre 2"), true);
  assert.equal(hasStreetNumber("Av. del Libertador s/n, Núñez"), true);
  assert.equal(hasStreetNumber("Ruta 8 sin número, Pilar"), true);
  assert.equal(hasStreetNumber("Santa Fe, Palermo"), false);
  assert.equal(hasStreetNumber("Santa Fe piso A depto B"), false);
});

test("resumen por renglones con dirección corta y la pregunta de pago al final", () => {
  const t = renderQuoteSummary({
    lines: [{ name: "Grande de muzzarella", qty: 1, price: 25000 }], subtotal: 25000, delivery_fee: 1270, total: 26270,
    resolved_address: "Army, 5000, Avenida Rivadavia, Caballito, Buenos Aires, Comuna 6, Ciudad Autónoma de Buenos Aires, C1424CER, Argentina",
  }, "Av Rivadavia 5000")!;
  assert.match(t, /^Resumen de tu pedido:\n\n• 1 x Grande de muzzarella — \$25\.000\n\n/);
  assert.match(t, /\*Total: \$26\.270\*/);
  assert.match(t, /^Dirección: Av\. Rivadavia 5000, Caballito$/m);
  assert.doesNotMatch(t, /Army|Comuna|C1424|Argentina/);
  assert.ok(t.endsWith("¿Cómo vas a pagar: efectivo o Mercado Pago?"));
});

import { menuPdfUrl, renderStatusReply } from "../workers/whatsapp-bot/src/bot/turn.ts";

test("la URL de la carta lleva versión por hora para que WhatsApp no mande una vieja", () => {
  assert.equal(menuPdfUrl("https://app.test", new Date("2026-11-18T18:45:00Z")), "https://app.test/api/public/carta.pdf?v=2026111818");
});

test("estado del pedido: respuesta fija con el estado real", () => {
  assert.match(renderStatusReply({ found: true, order_code: "#ABC", status: "Recibido", minutes_since_order: 10 }, 30)!, /#ABC ya lo recibimos[\s\S]*unos 20 minutos/);
  assert.match(renderStatusReply({ found: true, order_code: "#ABC", status: "En Preparación" }, 30)!, /en preparación/);
  assert.match(renderStatusReply({ found: true, order_code: "#ABC", status: "En Camino", courier: "Juan Pérez" }, 30)!, /en camino[\s\S]*Lo lleva Juan\./);
  assert.match(renderStatusReply({ found: false }, 30)!, /No encontré un pedido/);
  assert.match(renderStatusReply({ found: true, awaiting_payment: true, payment_url: "https://mpago.la/x" }, 30)!, /esperando el pago[\s\S]*mpago/);
  assert.equal(renderStatusReply({ found: true }, 30), null);
});

import { soundsLikeComplaint } from "../workers/whatsapp-bot/src/bot/turn.ts";

test("queja por demora no se confunde con la consulta tranquila de estado", () => {
  for (const q of ["hace 1 hora y media que espero!!", "no llega nunca", "todavía no llegó y hace 2 horas", "me llegó fría"]) assert.ok(soundsLikeComplaint(q), q);
  for (const q of ["¿cómo va mi pedido?", "ya salió?", "dónde está mi pedido"]) assert.ok(!soundsLikeComplaint(q), q);
});
