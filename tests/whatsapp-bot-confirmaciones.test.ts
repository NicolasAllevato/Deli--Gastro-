/** Bugs que encontró el simulador: confirmaciones con texto extra, estados afirmados por el modelo y quejas. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { asksCancelConfirmation, CANCEL_PROMPT, ORDER_REPLIES, claimsOrderState, extractPrices, isAffirmation, money, ORDER_STATE_SAFE_REPLY, PRICE_SAFE_REPLY, unknownPrices } from "../workers/whatsapp-bot/src/orders/flow.ts";
import { processTurn } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { REPLIES } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { d1BotRepo, d1InboundRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { fakeOrders, openSimDb, seedWorld } from "../scripts/simulador/mundo.ts";
import { toolsForIntent } from "../workers/whatsapp-bot/src/guardrails.ts";
import { buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";

describe("isAffirmation con texto extra", () => {
  it("cancelar: acepta SÍ con mayúsculas y relleno", () => {
    for (const ok of ["SÍ, CANCELA TODO.", "si dale", "sí porfa", "Sí, cancelalo", "SII seguro", "dale, cancelá nomás"]) {
      assert.equal(isAffirmation(ok, "cancel"), true, ok);
    }
  });
  it("confirmar: acepta SÍ con relleno y palabras de confirmar", () => {
    for (const ok of ["SÍ, todo bien!", "si, confirmo", "sí dale porfa", "Dale, adelante", "si perfecto gracias"]) {
      assert.equal(isAffirmation(ok, "confirm"), true, ok);
    }
  });
  it("sin falsos positivos", () => {
    const no = ["si no", "no sé", "si pero sin cebolla", "sí? cuánto sale", "ok", "listo", "de acuerdo", "si, agregá una coca",
      "si mañana", "no, mejor no", "sí, cancelá y pedime otra", "si quiero cambiar la direccion"];
    for (const t of no) {
      assert.equal(isAffirmation(t, "confirm"), false, `confirm: ${t}`);
      assert.equal(isAffirmation(t, "cancel"), false, `cancel: ${t}`);
    }
  });
  it("cada operación solo acepta sus propias palabras", () => {
    assert.equal(isAffirmation("SÍ, CANCELA TODO.", "confirm"), false);
    assert.equal(isAffirmation("si, confirmar", "cancel"), false);
    assert.equal(isAffirmation("SÍ, CANCELA TODO."), false);
    assert.equal(isAffirmation("sí porfa"), true);
  });
  it("mensajes largos nunca cuentan", () => {
    assert.equal(isAffirmation(`si ${"porfa ".repeat(12)}`, "confirm"), false);
  });
});

describe("guardrail: el modelo no afirma estados del pedido", () => {
  it("detecta confirmado, pagado, en camino, en proceso", () => {
    for (const t of [
      "¡Perfecto, Laura! 😊 Tu pedido está confirmado.",
      "Tu pedido está en proceso y la demora estimada es de 40 minutos. ¡Ya casi llega!",
      "El pedido ya está en camino",
      "Listo, el pago fue acreditado",
      "Su pedido quedó pagado, gracias",
    ]) assert.equal(claimsOrderState(t), true, t);
  });
  it("no confunde respuestas normales", () => {
    for (const t of [
      "¿Querés confirmar el pedido? Respondé SÍ al resumen.",
      "Tu pedido se confirma cuando se acredite el pago.",
      "Tenemos muzzarella y napolitana.",
      "Necesito la dirección para cotizar tu pedido.",
      ORDER_STATE_SAFE_REPLY,
    ]) assert.equal(claimsOrderState(t), false, t);
  });
});

describe("asksCancelConfirmation", () => {
  it("detecta la pregunta de cancelar escrita a mano", () => {
    assert.equal(asksCancelConfirmation("Entiendo, Don Carlos. ¿Confirmás que querés cancelar el pedido?"), true);
    assert.equal(asksCancelConfirmation("¿Estás seguro de que querés cancelar?"), true);
    assert.equal(asksCancelConfirmation("Listo, cancelamos tu pedido."), false);
    assert.equal(asksCancelConfirmation("¿Confirmás la dirección?"), false);
  });
});

/** Mundo mínimo con el processTurn real: SQLite con el esquema de D1 y un modelo falso con guion. */
async function world(intent: string, toolCalls: Array<{ name: string; arguments: unknown }>, final: string) {
  const db = openSimDb(":memory:");
  seedWorld(db);
  const inbound = d1InboundRepo(db);
  // Charla ya empezada (sin saludo de bienvenida) y sin tickets: el reloj real no cambia el resultado.
  const repo = { ...d1BotRepo(db), lastOutboundAt: async () => new Date(), createComplaint: undefined };
  const phone = "5491170000009";
  const conv = await inbound.upsertConversation(phone, "Juli");
  const sent: string[] = [];
  const run = async (_m: string, input: Record<string, unknown>) => {
    if ("response_format" in input) return { response: JSON.stringify({ intent, confidence: 0.95 }) };
    const used = (input.messages as { role: string }[]).filter((m) => m.role === "tool").length;
    return used < toolCalls.length ? { tool_calls: [toolCalls[used]] } : { response: final };
  };
  const send = async (text: string) => {
    await inbound.saveInbound(conv.id, { wamid: `in-${sent.length}`, type: "text", body: text });
    const outcome = await processTurn(
      { phone, text, wamids: [`in-${sent.length}`], audios: [], receivedAt: 0 },
      { repo, run, transcribe: async () => null, send: async (_p, t) => { sent.push(t); return `o-${sent.length}`; }, appUrl: "https://opsyndely.la-gambeta.com", orders: fakeOrders(db), log: () => {} },
    );
    return outcome;
  };
  return { send, sent, repo, phone };
}

describe("turno completo", () => {
  it("queja: el mensaje empático sale aunque el modelo haya derivado en el mismo turno", async () => {
    const w = await world("pedido_estado", [{ name: "handoff_to_human", arguments: { reason: "demora" } }], "Perdón por la demora, te paso con una persona del local.");
    assert.equal(await w.send("hace 1 hora y media que espero!!"), "answered");
    assert.deepEqual(w.sent, ["Perdón por la demora, te paso con una persona del local."]);
    assert.equal((await w.repo.getConversation(w.phone))?.humanTakeover, true);
  });
  it("queja: si el modelo deriva sin texto, sale el aviso de traspaso", async () => {
    const w = await world("pedido_estado", [{ name: "handoff_to_human", arguments: { reason: "demora" } }], "");
    await w.send("no llega nunca");
    assert.deepEqual(w.sent, [REPLIES.handoff]);
  });
  it("cancelar: la pregunta escrita a mano se reemplaza por la plantilla oficial", async () => {
    const w = await world("pedido_cancelar", [], "Entiendo. ¿Confirmás que querés cancelar el pedido?");
    await w.send("NO, MEJOR NO, CANCELA EL PEDIDO.");
    // La pregunta a mano pasa por runCancel: sin pedido en curso no se pregunta nada, se deriva con un mensaje claro.
    assert.deepEqual(w.sent, [ORDER_REPLIES.noOrderHandoff]);
    assert.ok(!w.sent.some((m) => m.startsWith(CANCEL_PROMPT)));
  });
  it("el modelo no puede decir que el pedido está confirmado", async () => {
    const w = await world("pedido_confirmar", [], "¡Perfecto! Tu pedido está confirmado.");
    await w.send("perfecto, todo bien");
    // El modelo insiste (también en el reintento): sale un reemplazo fijo que no afirma ningún estado.
    assert.equal(w.sent.length, 1);
    assert.doesNotMatch(w.sent[0], /confirmad|pagad|en camino/i);
    assert.match(w.sent[0], /acredite el pago/);
  });
});

describe("precios", () => {
  it("extrae montos en pesos con distintos formatos", () => {
    assert.deepEqual(extractPrices("Coca $3.500, agua $ 1500 y pizza $12,500. Envío $1.500,00"), [3500, 1500, 12500, 1500]);
    assert.deepEqual(extractPrices("sin precios"), []);
  });
  it("marca los precios que no están en el menú (la Coca a $350)", () => {
    const menu = [3500, 1500, 1800];
    assert.deepEqual(unknownPrices("Coca-Cola 1,5 L: $350", menu), [350]);
    assert.deepEqual(unknownPrices("Coca $3.500 y 2 empanadas $3.600", menu), []);
    assert.deepEqual(unknownPrices("Agua $150", menu), [150]);
  });
  it("get_menu devuelve price_text formateado", () => {
    assert.equal(money(3500), "$3.500");
    assert.equal(money(12500), "$12.500");
  });
  it("turno completo: un precio inventado no llega al cliente", async () => {
    const w = await world("consulta_menu", [], "Tenemos Coca-Cola 1,5 L a $350 y agua a $150.");
    assert.equal(await w.send("que bebidas tienen?"), "output_blocked");
    assert.deepEqual(w.sent, [PRICE_SAFE_REPLY]);
  });
  it("turno completo: los precios reales pasan", async () => {
    const w = await world("consulta_menu", [], "Tenemos Coca-Cola 1,5 L a $3.500 y agua a $1.500.");
    assert.equal(await w.send("que bebidas tienen?"), "answered");
    assert.equal(w.sent.length, 1);
    // La respuesta del modelo sale intacta; en una consulta de precios el código le suma (una vez) la línea del portal.
    assert.match(w.sent[0], /^Tenemos Coca-Cola 1,5 L a \$3\.500 y agua a \$1\.500\.(\n\nTambién podés pedir directo desde nuestra web: \S+\/cliente)?$/);
  });
  it("el prompt pide copiar el precio formateado", () => {
    assert.match(buildResponderPrompt(settingsFromConfig({}), "consulta_menu", null, false), /price_text/);
  });
});

describe("quejas", () => {
  it("pedido_estado puede derivar a una persona", () => {
    assert.ok(toolsForIntent("pedido_estado").includes("handoff_to_human"));
  });
  it("el prompt pide empatizar y derivar sin pedir verificación", () => {
    const p = buildResponderPrompt(settingsFromConfig({}), "pedido_estado", null, false);
    assert.match(p, /empatizá/);
    assert.match(p, /handoff_to_human/);
    assert.match(p, /no le pidas que verifique/);
  });
});
