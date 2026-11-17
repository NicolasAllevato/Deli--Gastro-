/**
 * Ciclo de mejora del bot (simulación de 100 conversaciones del 2026-11-17): SÍ con pregunta o emojis,
 * cancelación que consulta el pedido, borradores vacíos o bloqueados con reintento, y "un momento" prohibido.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAffirmation, trailingQuestion, promisesLater, lastDecisiveBotMessage, QUOTE_MARKER, CANCEL_PROMPT, ORDER_REPLIES,
  runCancel, newOrderState, type OrderTurn,
} from "../workers/whatsapp-bot/src/orders/flow.ts";
import type { OrdersClient, OrderResponse } from "../workers/whatsapp-bot/src/orders/client.ts";
import { respond, MAX_STEPS } from "../workers/whatsapp-bot/src/ai/responder.ts";
import { toolsForIntent } from "../workers/whatsapp-bot/src/guardrails.ts";

const SUMMARY = `${QUOTE_MARKER}:\n• 1 x Muzza — $12.500\nTotal: $14.000\nRespondé SÍ para continuar al pago.`;

describe("SÍ con pregunta, frase o emojis", () => {
  it("confirma lo que antes trababa el pedido", () => {
    for (const ok of [
      "SÍ! 😊 Espero el link para el pago!", "Sí, confirmo el pedido! 🍕🍰 ¿Cuánto tardan en llegar?", "si, hacelo! 😊",
      "SÍ, quiero continuar con el pago.", "SÍ, perfecto! 😄 Cuando me lo traen?", "SÍ 😊", "SÍ! 🙌 Vamos con el pago! 💳",
      "Sí, todo correcto. Continuemos con el pago. 😊", "SÍ! 😊 ¿Me mandás el link para pagar?",
    ]) {
      assert.equal(isAffirmation(ok, "confirm"), true, ok);
    }
  });
  it("sigue rechazando cambios, negaciones y preguntas sobre el SÍ", () => {
    for (const no of [
      "si pero sin cebolla", "SÍ, todo bien! 😊 También quiero agregar dos de carne", "sí, dale con 2 muzzas a Belgrano 123",
      "si no", "no sé", "sí? cuánto sale", "¿dale?", "Sí, me gustaría hacer un pedido. Voy a pedir una pizza", "si, mejor mañana",
      "sí, cambiá la fugazzeta por una napo", "si, sacale la coca",
    ]) {
      assert.equal(isAffirmation(no, "confirm"), false, no);
    }
  });
  it("cancelar: el enojo no anula el SÍ, pero dudar o negar sí", () => {
    assert.equal(isAffirmation("SÍ, CANCELAR YA!!! NO QUIERO ESPERAR MÁS!!! 😡", "cancel"), true);
    assert.equal(isAffirmation("SÍ, CANCELALO. 😤", "cancel"), true);
    for (const no of ["si pero esperá", "sí, no lo canceles", "si, mejor no", "si, confirmar", "si, agregá una coca"]) {
      assert.equal(isAffirmation(no, "cancel"), false, no);
    }
  });
  it("detecta la pregunta que viene con el SÍ para contestarla", () => {
    assert.equal(trailingQuestion("Sí, confirmo! ¿Cuánto tardan en llegar?"), "demora");
    assert.equal(trailingQuestion("SÍ! ¿Me mandás el link para pagar?"), "pago");
    assert.equal(trailingQuestion("SÍ 😊"), null);
  });
});

describe("el SÍ que sigue a un 'respondé SÍ al resumen' del modelo confirma ese resumen", () => {
  it("se saltea un solo texto libre que pide el SÍ", () => {
    assert.equal(lastDecisiveBotMessage(["Para continuar necesito que respondas SÍ al resumen que te envié.", SUMMARY]), SUMMARY);
    // Otro texto libre (no pide SÍ) corta: no se confirma un resumen viejo.
    assert.equal(lastDecisiveBotMessage(["¿Querés cambiar algo más?", SUMMARY]), "¿Querés cambiar algo más?");
    assert.equal(lastDecisiveBotMessage([]), null);
  });
});

describe("nunca prometer para después", () => {
  it("detecta 'un momento' y promesas de acciones futuras", () => {
    for (const t of ["Voy a intentarlo de nuevo. Un momento, por favor.", "Ya te lo mando", "Voy a pasar tu consulta a un compañero"]) {
      assert.equal(promisesLater(t), true, t);
    }
    assert.equal(promisesLater("La demora estimada es de 40 minutos."), false);
  });
});

function cancelTurn(status: Record<string, unknown> | null, recentQuote = false) {
  const calls: string[] = [];
  let takeover = false;
  const ok = (data: Record<string, unknown>): OrderResponse => ({ ok: true, status: 200, data: { ok: true, ...data } });
  const client = {
    status: async () => { calls.push("status"); return status ? ok(status) : ({ ok: false, kind: "network", status: 0, code: "network", error: "x" } as OrderResponse); },
    cancel: async () => { calls.push("cancel"); return ok({}); },
  } as unknown as OrdersClient;
  const t: OrderTurn = {
    client, repo: { setTakeover: async () => { takeover = true; } } as unknown as OrderTurn["repo"],
    conversation: { id: "c1", phone: "5491100000000" } as OrderTurn["conversation"], inboundWamid: "w1", inboundText: "quiero cancelar",
    hasAudio: false, lastBotMessage: null, recentQuote, appUrl: "https://x.test", hours: { open: "00:00", close: "23:59" }, state: newOrderState(),
  };
  return { t, calls, takeover: () => takeover };
}

describe("cancelación: primero se mira el pedido", () => {
  it("pedido en Recibidos o con pago pendiente: pregunta con la plantilla", async () => {
    for (const st of [{ found: true, status: "Recibidos" }, { found: true, awaiting_payment: true }]) {
      const c = cancelTurn(st);
      await runCancel(c.t, { confirmed: false });
      assert.equal(c.t.state.fixedReply, CANCEL_PROMPT);
      assert.equal(c.takeover(), false);
    }
  });
  it("sin pedido: deriva a una persona con un mensaje claro", async () => {
    const c = cancelTurn({ found: false });
    await runCancel(c.t, { confirmed: false });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.noOrderHandoff);
    assert.equal(c.takeover(), true);
    assert.equal(c.t.state.handedOff, true);
  });
  it("solo un resumen sin confirmar: lo descarta sin cobrar ni derivar", async () => {
    const c = cancelTurn({ found: false }, true);
    await runCancel(c.t, { confirmed: false });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.draftDropped);
    assert.equal(c.takeover(), false);
  });
  it("ya en preparación: explica y deriva enseguida", async () => {
    const c = cancelTurn({ found: true, status: "En preparación" });
    await runCancel(c.t, { confirmed: false });
    assert.match(c.t.state.fixedReply ?? "", /En preparación.*persona del local/);
    assert.equal(c.takeover(), true);
  });
  it("sin estado (red): pregunta igual y decide el servidor", async () => {
    const c = cancelTurn(null);
    await runCancel(c.t, { confirmed: false });
    assert.equal(c.t.state.fixedReply, CANCEL_PROMPT);
  });
});

describe("el responder nunca queda vacío por agotar herramientas", () => {
  it("la última vuelta pide texto (tool_choice none)", async () => {
    const seen: unknown[] = [];
    const run = async (_m: string, input: Record<string, unknown>) => {
      seen.push(input.tool_choice);
      return seen.length < MAX_STEPS
        ? { choices: [{ message: { tool_calls: [{ id: `t${seen.length}`, type: "function", function: { name: "get_menu", arguments: "{}" } }] } }] }
        : { choices: [{ message: { content: "Tenemos muzza a $12.500." } }] };
    };
    const tool = { name: "get_menu", description: "menú", parameters: { type: "object", properties: {} }, run: async () => [] };
    const text = await respond(run as never, { system: "s", history: [], userText: "hola", tools: [tool] });
    assert.equal(text, "Tenemos muzza a $12.500.");
    assert.equal(seen.at(-1), "none");
    assert.equal(seen.filter((x) => x === "none").length, 1);
  });
});

describe("herramientas por intención", () => {
  it("una consulta de menú con dirección puede cotizar; confirmar puede releer el menú", () => {
    assert.ok(toolsForIntent("consulta_menu").includes("quote_order"));
    assert.ok(toolsForIntent("pedido_confirmar").includes("get_menu"));
    assert.ok(!toolsForIntent("consulta_menu").includes("confirm_order"));
  });
});
