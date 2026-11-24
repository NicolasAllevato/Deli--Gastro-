import { test } from "node:test";
import assert from "node:assert/strict";
import { asksHugeQuantity, editsLastSummary, exposesInternalLimit } from "../workers/whatsapp-bot/src/bot/turn.ts";

test("detecta el rechazo propio del modelo a un pedido grande", () => {
  assert.equal(exposesInternalLimit("Pido disculpas, pero no puedo procesar un pedido de 150 empanadas de carne. ¿Te gustaría pedir una cantidad menor?"), true);
  assert.equal(exposesInternalLimit("No podemos tomar ese pedido."), true);
});

test("no marca respuestas normales", () => {
  assert.equal(exposesInternalLimit("Resumen de tu pedido: 2 x Muzzarella grande"), false);
  assert.equal(exposesInternalLimit("¿Querés agregar algo más al pedido?"), false);
});

test("cantidad por encima del tope de unidades", () => {
  assert.equal(asksHugeQuantity("quiero 150 empanadas de carne"), true);
  assert.equal(asksHugeQuantity("quiero 2 muzzarellas"), false);
  assert.equal(asksHugeQuantity("100 empanadas"), false);
  assert.equal(asksHugeQuantity("2 cafés para Juramento 1500"), false);
  assert.equal(asksHugeQuantity("2 muzza a Av. Santa Fe 1234, Palermo"), false);
  assert.equal(asksHugeQuantity("150 de carne a Santa Fe 1234"), true);
});

test("último mensaje es un resumen editable", () => {
  assert.equal(editsLastSummary("Resumen de tu pedido:\n• 3 x Muzzarella grande"), true);
  assert.equal(editsLastSummary("Hola, ¿qué querés pedir?"), false);
  assert.equal(editsLastSummary(null), false);
});
