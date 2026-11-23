/** Promo con grupo «min 2 / max 2»: el modelo recibe cuántas opciones pedir (la descripción dice «una gaseosa»). */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { chooseText, optionGroupsForModel } from "../workers/whatsapp-bot/src/bot/menu.ts";
import { buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";

describe("grupos de opciones: cuántas elegir", () => {
  it("min = max = 2 pide exactamente 2", () => {
    assert.match(String(chooseText({ min: 2, max: 2 }).elegir), /exactamente 2/);
  });
  it("solo mínimo, o sin cantidad", () => {
    assert.match(String(chooseText({ min: 1, max: 3 }).elegir), /al menos 1 y como mucho 3/);
    assert.deepEqual(chooseText({ min: null, max: null }), {});
    assert.deepEqual(chooseText({ min: 0, max: 2 }), {});
  });
  it("get_menu lo incluye en cada grupo usado", () => {
    const menu = [{ id: "p", name: "Baila Ahora", description: "incluye una gaseosa", price: 1, category: "Promos", groups: [3] }];
    const out = optionGroupsForModel(menu, { "3": { name: "bebidas promo", min: 2, max: 2, options: [{ id: 14, name: "Pepsi (Lata)" }] } });
    assert.match(String(out["3"].elegir), /exactamente 2/);
  });
  it("el prompt de pedidos manda pedir lo que fija el grupo y ofrecer todas las variantes de un producto inexistente", () => {
    const prompt = buildResponderPrompt(settingsFromConfig({ bot_orders_enabled: true }), "pedido_nuevo", null, false);
    assert.match(prompt, /EXACTAMENTE lo que pide el grupo/);
    assert.match(prompt, /café con leche/);
    assert.match(prompt, /TODAS esas variantes/);
  });
});
