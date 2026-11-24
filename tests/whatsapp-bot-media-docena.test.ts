import { test } from "node:test";
import assert from "node:assert/strict";
import { checkQuoteAgainstText } from "../workers/whatsapp-bot/src/orders/quote-check.ts";

const MENU = [
  { id: "doc", name: "Docena de empanadas" },
  { id: "pol", name: "Empanada de pollo" },
  { id: "hum", name: "Empanada de humita" },
];

test("media docena cotizada como Docena se rechaza", () => {
  const err = checkQuoteAgainstText("quiero media docena de pollo y 3 de humita", [{ product_id: "doc", qty: 1 }, { product_id: "hum", qty: 3 }], MENU);
  assert.match(err ?? "", /media docena/);
});

test("media docena como 6 sueltas pasa", () => {
  assert.equal(checkQuoteAgainstText("quiero media docena de pollo y 3 de humita", [{ product_id: "pol", qty: 6 }, { product_id: "hum", qty: 3 }], MENU), null);
});

test("docena y media no se controla", () => {
  assert.equal(checkQuoteAgainstText("una docena y media de pollo", [{ product_id: "doc", qty: 1 }, { product_id: "pol", qty: 6 }], MENU), null);
});
