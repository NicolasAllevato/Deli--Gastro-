import { describe, it } from "node:test";
import assert from "node:assert/strict";
import "./helpers/alias.ts";
import { bareNumberHint } from "../workers/whatsapp-bot/src/bot/turn.ts";

describe("respuesta numérica corta: se interpreta con la última pregunta del bot", () => {
  it("un número suelto tras preguntar la dirección o la cantidad es la CANTIDAD, no la dirección", () => {
    for (const lastBot of ["Perfecto, una pizza muzzarella grande. ¿Cuál es la dirección de entrega?", "¿Cuántas querés?", "¿Cuántos?"]) {
      for (const text of ["2", " 3 ", "12"]) {
        const hint = bareNumberHint(text, lastBot);
        assert.ok(hint, `${text} / ${lastBot}`);
        assert.match(hint!, /cantidad/i);
        assert.match(hint!, /no (es )?una direcci[oó]n/i);
      }
    }
  });

  it("no actúa con direcciones, textos con palabras, números largos ni sin pregunta previa", () => {
    assert.equal(bareNumberHint("Santa Fe 2", "¿Cuál es la dirección?"), null);
    assert.equal(bareNumberHint("2 muzzas", "¿Cuántas querés?"), null);
    assert.equal(bareNumberHint("1500", "¿Cuál es la dirección?"), null);
    assert.equal(bareNumberHint("2", null), null);
    assert.equal(bareNumberHint("2", "Resumen de tu pedido"), null);
  });
});

describe("pista de empanadas con cantidad y gusto", () => {
  it("aparece con docenas o gusto y cantidad, y no en otros pedidos", async () => {
    const { empanadaHint } = await import("../workers/whatsapp-bot/src/bot/turn.ts");
    for (const t of ["una docena y media de carne para delivery a Santa Fe 1234", "quiero 150 empanadas de carne", "18 de carne"]) {
      const h = empanadaHint(t);
      assert.ok(h, t);
      assert.match(h!, /docena y media = 18/);
      assert.match(h!, /no le menciones topes/);
    }
    assert.equal(empanadaHint("agregá otra igual"), null);
    assert.equal(empanadaHint("2 muzzarellas grandes a Santa Fe 1234"), null);
  });
});

describe("pista de sabor sin categoría", () => {
  it("«la de jamón y morrón» busca en todas las categorías; con categoría nombrada no", async () => {
    const { flavorHint } = await import("../workers/whatsapp-bot/src/bot/turn.ts");
    assert.match(flavorHint("[audio] eh hola si quería saber si tienen eh la de jamón y morrón y cuánto sale el envío")!, /TODAS las categorías/);
    assert.equal(flavorHint("quiero una pizza de muzzarella"), null);
    assert.equal(flavorHint("una docena de carne"), null);
    assert.equal(flavorHint("hola buenas"), null);
  });
});
