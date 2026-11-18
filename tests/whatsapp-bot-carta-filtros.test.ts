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
