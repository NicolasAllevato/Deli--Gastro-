import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptsSavedAddress, profileAddressUnconfirmed, savedAddressAcceptedHint } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { asksHugeQuantity } from "../workers/whatsapp-bot/src/bot/turn.ts";

const SAVED = "Avenida Rivadavia 5000, piso 3 dto B";
const GENERIC = "Para tu pedido, tengo 6 de pollo y 3 de humita.\n\n¿Me podés confirmar la dirección de entrega?";

test("«a esa dirección» ante la pregunta genérica acepta la guardada", () => {
  assert.equal(acceptsSavedAddress(GENERIC, "Si, a esa dirección"), true);
  assert.equal(acceptsSavedAddress(GENERIC, "la de siempre"), true);
  assert.equal(acceptsSavedAddress(`¿Te lo enviamos a ${SAVED}?`, "sí"), true);
});

test("no acepta la guardada si da otra calle o solo dice sí a la pregunta genérica", () => {
  assert.equal(acceptsSavedAddress(GENERIC, "a esa no, a Juramento 1500"), false);
  assert.equal(acceptsSavedAddress(GENERIC, "sí"), false);
  assert.equal(acceptsSavedAddress("¿Algo más?", "esa"), false);
  assert.equal(acceptsSavedAddress(null, "a esa"), false);
});

test("la pista y el control de herramientas usan la misma regla", () => {
  assert.match(savedAddressAcceptedHint("Si, a esa dirección", GENERIC, SAVED) ?? "", /quote_order YA/);
  assert.equal(profileAddressUnconfirmed(SAVED, SAVED, [], GENERIC, "Si, a esa dirección"), false);
  assert.equal(profileAddressUnconfirmed(SAVED, SAVED, [], GENERIC, "sí"), true);
});

test("pedido enorme dicho un mensaje antes de confirmar la dirección", () => {
  const texts = ["Hola, quiero 150 empanadas de carne para mañana", "Si, ahi"];
  assert.equal(asksHugeQuantity(texts.join("\n")), true);
  assert.equal(asksHugeQuantity("Si, ahi"), false);
});
