import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkQuoteAgainstText } from "../workers/whatsapp-bot/src/orders/quote-check.ts";
import { asksCredit } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { cartaMenuForModel } from "../workers/whatsapp-bot/src/bot/menu.ts";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number, name: string, category = "Otros") => ({ id: id(n), name, description: null, price: 1000, category });
const MENU = [
  item(1, "Empanada de carne"), item(2, "Empanada de pollo"), item(3, "Docena de empanadas"),
  item(4, "Agua con gas"), item(5, "Agua sin gas"),
  item(6, "Porcion Fugazzeta"), item(7, "Grande Jamón y morrones"), item(8, "Porcion Jamón y morrones"), item(9, "Grande de Fugazzeta"),
  item(10, "Empanada de jamón y queso"), item(11, "Coca-Cola 1,5 L"), item(12, "Muzzarella grande"),
];
const line = (n: number, qty: number) => ({ product_id: id(n), qty });
const TEXTO = "mejor 6 empanadas de carne y 6 de pollo, 2 aguas sin gas y una grande de jamón y morrón para Juramento 1500";

describe("checkQuoteAgainstText: variantes", () => {
  it("rechaza «con gas» cuando el cliente pidió «sin gas», y ofrece la correcta", () => {
    const error = checkQuoteAgainstText(TEXTO, [line(1, 6), line(2, 6), line(4, 2), line(7, 1)], MENU);
    assert.ok(error);
    assert.match(error, /sin gas/);
    assert.match(error, /Agua sin gas/);
    assert.ok(error.includes(id(5)));
  });

  it("rechaza «Porcion Fugazzeta» cuando pidió una grande de jamón y morrón", () => {
    const error = checkQuoteAgainstText(TEXTO, [line(1, 6), line(2, 6), line(5, 2), line(6, 1)], MENU);
    assert.ok(error);
    assert.match(error, /grande/i);
    assert.ok(error.includes(id(7)), "ofrece Grande Jamón y morrones");
  });

  it("acepta el pedido correcto", () => {
    assert.equal(checkQuoteAgainstText(TEXTO, [line(1, 6), line(2, 6), line(5, 2), line(7, 1)], MENU), null);
  });

  it("si el cliente nombra las dos variantes no marca nada", () => {
    assert.equal(checkQuoteAgainstText("un agua con gas y una sin gas", [line(4, 1), line(5, 1)], MENU), null);
    assert.equal(checkQuoteAgainstText("una grande de fugazzeta y 2 porciones de fugazzeta", [line(9, 1), line(6, 2)], MENU), null);
  });

  it("no marca productos sin variante en el texto", () => {
    assert.equal(checkQuoteAgainstText("2 aguas", [line(4, 2)], MENU), null);
  });
});

describe("checkQuoteAgainstText: cantidades", () => {
  it("rechaza 12 de carne cuando pidió 6", () => {
    const error = checkQuoteAgainstText(TEXTO, [line(1, 12), line(2, 6), line(5, 2), line(7, 1)], MENU);
    assert.ok(error);
    assert.match(error, /6/);
    assert.match(error, /carne/i);
  });

  it("acepta la cantidad repartida en varias líneas que suma lo pedido", () => {
    assert.equal(checkQuoteAgainstText("6 empanadas de carne para Belgrano 1", [line(1, 3), line(1, 3)], MENU), null);
  });

  it("acepta números de palabra", () => {
    assert.equal(checkQuoteAgainstText("dos aguas sin gas", [line(5, 2)], MENU), null);
    assert.ok(checkQuoteAgainstText("dos aguas sin gas", [line(5, 3)], MENU));
  });

  it("no se confunde cuando el mismo token aparece en dos productos y ambos números cierran", () => {
    assert.equal(checkQuoteAgainstText("1 grande de jamón y morrón y 2 de jamón y queso", [line(7, 1), line(10, 2)], MENU), null);
  });

  it("rechaza otro producto: «2 aguas sin gas» cotizadas como Coca-Cola", () => {
    const error = checkQuoteAgainstText(TEXTO, [line(1, 6), line(2, 6), line(11, 2), line(7, 1)], MENU);
    assert.ok(error);
    assert.match(error, /Agua/);
    assert.ok(error.includes(id(5)) || error.includes(id(4)));
  });

  it("no marca «muzza con jamón» si la línea es la muzzarella", () => {
    assert.equal(checkQuoteAgainstText("2 muzzas grandes con jamón para Belgrano 1", [line(12, 2)], MENU), null);
  });

  it("con docenas o medias docenas no controla cantidades", () => {
    assert.equal(checkQuoteAgainstText("una docena y media de carne", [line(1, 18)], MENU), null);
  });

  it("un número de dirección no cuenta como cantidad", () => {
    assert.equal(checkQuoteAgainstText("2 de carne a Pasaje Carne 1500", [line(1, 2)], MENU), null);
  });
});

describe("saldo a favor", () => {
  it("«hola, ¿tengo saldo a favor?» lo detecta el paso fijo", () => {
    assert.ok(asksCredit("hola, ¿tengo saldo a favor?"));
  });
});

describe("carta: el modelo ve el nombre real del producto", () => {
  it("cada variante lleva `producto` con el nombre del menú", () => {
    const carta = [{ titulo: "Pizzas", columnas: ["8 porciones", "Porción"], estilo: "lista" as const, nota: null,
      items: [{ nombre: "Jamón y morrón", nota: null, productos: [{ id: id(7), price: 1 }, { id: id(8), price: 1 }] }] }];
    const out = cartaMenuForModel(carta, MENU, true) as { carta: { productos: { id: string; producto?: string }[] }[]; nota: string };
    assert.deepEqual(out.carta[0]!.productos.map((p) => p.producto), ["Grande Jamón y morrones", "Porcion Jamón y morrones"]);
    assert.match(out.nota, /producto/);
  });
});
