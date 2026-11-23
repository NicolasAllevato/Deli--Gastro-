/**
 * Ciclo de mejora del bot (simulación de 100 conversaciones del 2026-11-17): SÍ con pregunta o emojis,
 * cancelación que consulta el pedido, borradores vacíos o bloqueados con reintento, y "un momento" prohibido.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isAffirmation, trailingQuestion, promisesLater, lastDecisiveBotMessage, QUOTE_MARKER, CANCEL_PROMPT, ORDER_REPLIES,
  runCancel, runConfirm, newOrderState, saysPaid, claimsOrderState, type OrderTurn,
} from "../workers/whatsapp-bot/src/orders/flow.ts";
import type { OrdersClient, OrderResponse } from "../workers/whatsapp-bot/src/orders/client.ts";
import { respond, MAX_STEPS } from "../workers/whatsapp-bot/src/ai/responder.ts";
import { toolsForIntent } from "../workers/whatsapp-bot/src/guardrails.ts";
import { toolsFor } from "../workers/whatsapp-bot/src/bot/tools.ts";
import { afterPaymentHandoff, closingAfterPayment, CLOSING_PAID, CLOSING_PENDING, lastQuoteAddress, PAID_CHANGE_HANDOFF, PAYMENT_PENDING_HANDOFF } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { isClosingMessage } from "../workers/whatsapp-bot/src/orders/flow.ts";
import { buildResponderPrompt } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { fakeOrders, openSimDb, seedWorld } from "../scripts/simulador/mundo.ts";

const SUMMARY = `${QUOTE_MARKER}:\n• 1 x Muzza — $12.500\nTotal: $14.000\nPago: Mercado Pago\nTe mando el link de pago. Respondé SÍ para confirmar.`;

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

function cancelConfirmed(cancel: OrderResponse, recentQuote = false) {
  let takeover = false;
  const client = { status: async () => ({ ok: true, status: 200, data: { ok: true, found: true, status: "Recibidos" } }), cancel: async () => cancel } as unknown as OrdersClient;
  const t: OrderTurn = {
    client, repo: { setTakeover: async () => { takeover = true; } } as unknown as OrderTurn["repo"],
    conversation: { id: "c1", phone: "5491100000000" } as OrderTurn["conversation"], inboundWamid: "w1", inboundText: "SÍ, CANCELALO",
    hasAudio: false, lastBotMessage: CANCEL_PROMPT, recentQuote, appUrl: "https://x.test", hours: { open: "00:00", close: "23:59" }, state: newOrderState(),
  };
  return { t, takeover: () => takeover };
}

describe("ronda 2: después de cancelar, el cliente sabe qué pasa con la plata", () => {
  it("pago pendiente cancelado: no se cobró nada, sin derivar", async () => {
    const c = cancelConfirmed({ ok: true, status: 200, data: { ok: true, note: "Se canceló el pago pendiente." } });
    await runCancel(c.t, { confirmed: true });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.cancelledUnpaid);
    assert.equal(c.takeover(), false);
  });
  it("pedido en efectivo (sin pago acreditado): cancelado normal, sin «ya estaba pagado» ni derivar", async () => {
    const c = cancelConfirmed({ ok: true, status: 200, data: { ok: true, paid: false } });
    await runCancel(c.t, { confirmed: true });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.cancelledCash);
    assert.doesNotMatch(ORDER_REPLIES.cancelledCash, /pagado|direcci[oó]n correcta/i);
    assert.equal(c.takeover(), false);
  });
  it("pedido ya pagado: se cancela y deriva para resolver el pago (sin prometer reembolso)", async () => {
    const c = cancelConfirmed({ ok: true, status: 200, data: { ok: true, paid: true } });
    await runCancel(c.t, { confirmed: true });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.cancelledPaid);
    assert.doesNotMatch(ORDER_REPLIES.cancelledPaid, /reembols|devolvemos|te devuelven/i);
    assert.equal(c.takeover(), true);
  });
  it("respuesta sin el campo paid: no se asume pagado", async () => {
    const c = cancelConfirmed({ ok: true, status: 200, data: { ok: true } });
    await runCancel(c.t, { confirmed: true });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.cancelledCash);
    assert.equal(c.takeover(), false);
  });
  it("SÍ a cancelar un resumen sin confirmar: se descarta sin derivar", async () => {
    const c = cancelConfirmed({ ok: false, kind: "api", status: 409, code: "rejected", error: "No encontré un pedido para cancelar." }, true);
    await runCancel(c.t, { confirmed: true });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.draftDropped);
    assert.equal(c.takeover(), false);
  });
  it("sin pedido y sin resumen: deriva", async () => {
    const c = cancelConfirmed({ ok: false, kind: "api", status: 409, code: "rejected", error: "No encontré un pedido para cancelar." });
    await runCancel(c.t, { confirmed: true });
    assert.equal(c.t.state.fixedReply, ORDER_REPLIES.noOrderHandoff);
    assert.equal(c.takeover(), true);
  });
  it("ya en preparación al confirmar: explica el motivo del servidor y deriva", async () => {
    const c = cancelConfirmed({ ok: false, kind: "api", status: 409, code: "rejected", error: "El pedido ya está en preparación y no se puede cancelar." });
    await runCancel(c.t, { confirmed: true });
    assert.match(c.t.state.fixedReply ?? "", /en preparación.*persona del local/);
    assert.equal(c.takeover(), true);
  });
});

describe("ronda 3", () => {
  it("'SÍ, confirmo que quiero cancelar' es un SÍ a cancelar; 'si, confirmar' no", () => {
    assert.equal(isAffirmation("SÍ, confirmo que quiero cancelar el pedido. 😔 Gracias!", "cancel"), true);
    assert.equal(isAffirmation("si, confirmar", "cancel"), false);
    assert.equal(isAffirmation("SÍ, CANCELA TODO.", "confirm"), false);
  });
  it("'ya pagué' se reconoce siempre como consulta de estado", () => {
    for (const t of ["Ya pagué! espero la pizza", "Listo, ya hice el pago 😊", "ok, ya lo pagué", "YA PAGUE HACE UN RATO"]) assert.equal(saysPaid(t), true, t);
    for (const t of ["¿cómo pago?", "quiero pagar con mercado pago", "pago en efectivo?"]) assert.equal(saysPaid(t), false, t);
  });
  it("'tu pedido estará listo en 40 minutos' lo dice solo el sistema", () => {
    assert.equal(claimsOrderState("Tu pedido estará listo en aproximadamente 40 minutos"), true);
    assert.equal(claimsOrderState("La demora estimada es de 40 minutos."), false);
  });
  it("después del link de pago, un mensaje no empieza un pedido de cero", async () => {
    const t: OrderTurn = {
      client: { confirm: async () => assert.fail("no debe confirmar") } as unknown as OrdersClient,
      repo: {} as OrderTurn["repo"], conversation: { id: "c1", phone: "1" } as OrderTurn["conversation"], inboundWamid: "w",
      inboundText: "sí, gracias!", hasAudio: false, lastBotMessage: "¡Listo! Para confirmar tu pedido pagá acá", recentPayment: true,
      appUrl: "https://x.test", hours: { open: "00:00", close: "23:59" }, state: newOrderState(),
    };
    const r = (await runConfirm(t, { payment_method: "Mercado Pago" })) as { ok: boolean; error: string };
    assert.equal(r.ok, false);
    assert.match(r.error, /link de pago/);
    assert.equal(t.state.fixedReply, null);
  });
});

describe("ronda 4", () => {
  function statusTool(data: Record<string, unknown>) {
    const ok = { ok: true, status: 200, data: { ok: true, ...data } } as OrderResponse;
    const t: OrderTurn = {
      client: { status: async () => ok } as unknown as OrdersClient, repo: {} as OrderTurn["repo"],
      conversation: { id: "c1", phone: "1", clientId: null } as unknown as OrderTurn["conversation"], inboundWamid: "w", inboundText: "ya pagué",
      hasAudio: false, lastBotMessage: null, appUrl: "https://x.test", hours: { open: "00:00", close: "23:59" }, state: newOrderState(),
    };
    const tool = toolsFor("pedido_estado", {} as never, t.conversation, settingsFromConfig({}), Date.now, t).find((x) => x.name === "order_status");
    assert.ok(tool);
    return tool.run({});
  }
  it("order_status dice explícito si el pago se acreditó o falta pagar", async () => {
    assert.equal(((await statusTool({ found: true, status: "Recibidos" })) as { payment: string }).payment, "acreditado");
    assert.match(((await statusTool({ found: true, awaiting_payment: true })) as { payment: string }).payment, /falta pagar/);
    assert.equal(((await statusTool({ found: false })) as { payment?: string }).payment, undefined);
  });
  it("el prompt prohíbe inventar promos y reemplazar productos", () => {
    const p = buildResponderPrompt(settingsFromConfig({}), "consulta_menu", null, false);
    assert.match(p, /nunca digas que sigue vigente/);
    assert.match(p, /nunca lo reemplaces por otro producto/);
  });
  it("mundo simulado: 'ya pagué' acredita solo si había un link pendiente", async () => {
    const db = openSimDb(":memory:");
    seedWorld(db);
    const o = fakeOrders(db);
    assert.equal(o.markPaid("c1"), false);
    const id = (db.raw.prepare("SELECT id FROM products LIMIT 1").get() as { id: string }).id;
    await o.quote({ conversationId: "c1", inboundWamid: "w", items: [{ product_id: id, qty: 1 }], address: "Santa Fe 1234" });
    await o.confirm({ conversationId: "c1", inboundWamid: "w2", payment_method: "Mercado Pago" });
    assert.equal(o.markPaid("c1"), true);
    const st = await o.status({ conversationId: "c1", inboundWamid: "w3" });
    assert.ok(st.ok && st.data.status === "Recibidos");
  });
});

describe("ronda 5: después del link de pago", () => {
  function turnWith(status: Record<string, unknown>, recentPayment = true): OrderTurn {
    const ok = { ok: true, status: 200, data: { ok: true, ...status } } as OrderResponse;
    return {
      client: { status: async () => ok } as unknown as OrdersClient, repo: {} as OrderTurn["repo"],
      conversation: { id: "c1", phone: "1" } as OrderTurn["conversation"], inboundWamid: "w", inboundText: "", hasAudio: false,
      lastBotMessage: null, recentPayment, appUrl: "https://x.test", hours: { open: "00:00", close: "23:59" }, state: newOrderState(),
    };
  }
  const PAGADO = { found: true, status: "Recibidos" };
  const PENDIENTE = { found: true, awaiting_payment: true };
  it("pedido pagado + cambio de dirección: lo cambia una persona", async () => {
    const msg = "Hice un error en la dirección, es Av. Santa Fe 4321. ¿Lo actualizan?";
    assert.equal(await afterPaymentHandoff(turnWith(PAGADO), "pedido_datos", msg, []), PAID_CHANGE_HANDOFF);
    // Sin pagar todavía: se re-cotiza normalmente (no se deriva).
    assert.equal(await afterPaymentHandoff(turnWith(PENDIENTE), "pedido_datos", msg, []), null);
    // Sin link de pago reciente: nada que derivar.
    assert.equal(await afterPaymentHandoff(turnWith(PAGADO, false), "pedido_datos", msg, []), null);
    // Un pedido nuevo sin pedir cambios no se deriva.
    assert.equal(await afterPaymentHandoff(turnWith(PAGADO), "pedido_nuevo", "quiero otra pizza más tarde", []), null);
  });
  it("'ya pagué' insistente con el pago pendiente: deriva para revisarlo", async () => {
    const prev = ["Perdón, pero parece que el pago aún está pendiente. Te reenvío el link: https://mpago.la/x"];
    assert.equal(await afterPaymentHandoff(turnWith(PENDIENTE), "pedido_estado", "Ya realicé el pago!", prev), PAYMENT_PENDING_HANDOFF);
    // Primera vez que avisa: todavía no se deriva (el bot consulta y responde).
    assert.equal(await afterPaymentHandoff(turnWith(PENDIENTE), "pedido_estado", "Ya realicé el pago!", ["¡Listo! Para confirmar tu pedido pagá acá"]), null);
  });
  it("la dirección del último resumen se reusa al re-cotizar", () => {
    const quote = `${QUOTE_MARKER}:\n• 1 x Muzza — $12.500\nDirección: AVENIDA SANTA FE 1234, PALERMO\nPago: Mercado Pago`;
    assert.equal(lastQuoteAddress(["Listo, dejamos ese pedido sin confirmar", quote]), "AVENIDA SANTA FE 1234, PALERMO");
    assert.equal(lastQuoteAddress(["hola"]), null);
  });
});

describe("ronda 6: cierres con calidez y sin afirmar estados", () => {
  function turnWith(status: Record<string, unknown>, recentPayment = true): OrderTurn {
    const ok = { ok: true, status: 200, data: { ok: true, ...status } } as OrderResponse;
    return {
      client: { status: async () => ok } as unknown as OrdersClient, repo: {} as OrderTurn["repo"],
      conversation: { id: "c1", phone: "1" } as OrderTurn["conversation"], inboundWamid: "w", inboundText: "", hasAudio: false,
      lastBotMessage: null, recentPayment, appUrl: "https://x.test", hours: { open: "00:00", close: "23:59" }, state: newOrderState(),
    };
  }
  it("reconoce cierres y pedidos de aviso, no cambios ni reclamos", () => {
    for (const t of [
      "Gracias! Estoy con mucha hambre, así que espero que llegue rápido! 😋🍕", "cuando salga el pedido me avisan por favor 😂🍕",
      "¿Pueden avisarme cuando salga el delivery? así no me pierdo el momento! 😅", "Perfecto, muchas gracias por la info. Estaré atenta. 😊",
    ]) assert.equal(isClosingMessage(t), true, t);
    for (const t of ["gracias, pero quiero cambiar la dirección", "ya pasaron 40 min y no llegó", "gracias! cuánto tarda?", "quiero pedir otra"]) {
      assert.equal(isClosingMessage(t), false, t);
    }
  });
  it("pagado: agradece y avisa que le escriben cuando salga; pendiente: sale cuando se acredite", async () => {
    const msg = "cuando salga el pedido me avisan por favor 😂🍕";
    assert.equal(await closingAfterPayment(turnWith({ found: true, status: "Recibidos" }), "saludo", msg), CLOSING_PAID);
    assert.equal(await closingAfterPayment(turnWith({ found: true, awaiting_payment: true }), "saludo", msg), CLOSING_PENDING);
    assert.equal(await closingAfterPayment(turnWith({ found: true, status: "Recibidos" }, false), "saludo", msg), null);
    // "Ya pagué" no es un cierre: va a la consulta de estado.
    assert.equal(await closingAfterPayment(turnWith({ found: true, status: "Recibidos" }), "saludo", "listo, ya pagué, gracias!"), null);
    for (const r of [CLOSING_PAID, CLOSING_PENDING]) assert.doesNotMatch(r, /perd[oó]n|en camino ya|est[aá] en camino\b/i);
  });
  it("'ya acreditó el pago' cuenta como aviso de pago", () => {
    assert.equal(saysPaid("Listo, ya acreditó el pago. ¿Me pueden confirmar el pedido?"), true);
  });
  it("el prompt aclara que un gracias no es una queja", () => {
    assert.match(buildResponderPrompt(settingsFromConfig({}), "saludo", null, false), /NO es una queja/);
  });
});


describe("notas del cliente en el pedido", () => {
  it("parseQuoteArgs acepta notes y las limpia; el resumen muestra «Nota: ...»", async () => {
    const { parseQuoteArgs, renderQuoteSummary } = await import("../workers/whatsapp-bot/src/orders/flow.ts");
    const id = "11111111-1111-4111-8111-111111111111";
    const parsed = parseQuoteArgs({ items: [{ product_id: id, qty: 1 }], address: "Juramento 1500, Belgrano", notes: "  PRUEBA - no preparar " });
    assert.equal(parsed?.notes, "PRUEBA - no preparar");
    assert.equal(parseQuoteArgs({ items: [{ product_id: id, qty: 1 }], address: "Juramento 1500", notes: 5 }), null);
    const text = renderQuoteSummary({ lines: [{ name: "Muzza", qty: 1, price: 1000 }], subtotal: 1000, delivery_fee: 0, total: 1000, resolved_address: "Juramento 1500, Belgrano", notes: "PRUEBA - no preparar" });
    assert.match(text!, /Nota: PRUEBA - no preparar/);
    assert.doesNotMatch(renderQuoteSummary({ lines: [{ name: "Muzza", qty: 1, price: 1000 }], subtotal: 1000, delivery_fee: 0, total: 1000, resolved_address: "Juramento 1500" })!, /Nota:/);
  });
});
