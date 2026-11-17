/** Simulador de clientes y aprendizaje de errores: todo lo que no llama a OpenAI. */
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createTestDb, seed, actors } from "./helpers/sqlite-d1.ts";
import { ForbiddenError, systemActor } from "../src/lib/data/actor.ts";
import {
  decide, decisionSchema, errorKey, listErrores, listSugerencias, normalizeKey, recordError, recordSugerencia, regressionCases, setRegressionResult,
} from "../src/lib/data/kb-aprendizaje.ts";
import { listKb } from "../src/lib/data/kb-negocio.ts";
import { d1BotRepo, d1InboundRepo } from "../workers/whatsapp-bot/src/repo/d1.ts";
import { processTurn } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { fakeOrders, menuText, openSimDb, seedWorld, simProductId } from "../scripts/simulador/mundo.ts";
import { buildResponderPrompt, lessonLines } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { generateScenarios, SCENARIO_TYPES } from "../scripts/simulador/escenarios.ts";
import { Budget, estimatePerConversation } from "../scripts/simulador/presupuesto.ts";
import { dedupeFailures, dedupeSuggestions, environmentSignals, inventedPrices, parseVerdict } from "../scripts/simulador/juez.ts";
import { parseQuoteArgs } from "../workers/whatsapp-bot/src/orders/flow.ts";
import { parseClientTurn } from "../scripts/simulador/cliente.ts";
import { renderReport, successByType } from "../scripts/simulador/informe.ts";
import { exportPendingSql } from "../scripts/simulador/sql-export.ts";

const sys = systemActor("test");
const falla = {
  escenario: "queja_reclamo", tipo: "no_resolvio" as const, mensaje_cliente: "la pizza llegó fria!!",
  respuesta_mala: "Qué pena", motivo: "No derivó la queja", correccion: "Ante una queja, empatizá y derivá a una persona.",
};

describe("escenarios", () => {
  it("rota los 4 tipos y es determinista", () => {
    const a = generateScenarios(8);
    assert.deepEqual(a.map((s) => s.type), [...SCENARIO_TYPES, ...SCENARIO_TYPES]);
    assert.deepEqual(generateScenarios(8), a);
    assert.equal(new Set(a.map((s) => s.id)).size, 8);
    assert.ok(a.filter((s) => s.type === "queja_reclamo").every((s) => s.mustHandoff));
  });
  it("los casos de regresión van primero, con su mensaje original", () => {
    const s = generateScenarios(3, [{ id: "e1", escenario: "queja_reclamo", mensaje_cliente: "hola??", motivo: "m", correccion: "c", tipo: "no_derivo" }]);
    assert.equal(s[0].type, "regresion");
    assert.equal(s[0].opener, "hola??");
    assert.equal(s[0].errorId, "e1");
    assert.equal(s[0].mustHandoff, true);
    assert.equal(s.length, 3);
    assert.equal(generateScenarios(0).length, 0);
  });
});

describe("presupuesto", () => {
  it("calcula el costo de GPT-4o mini y corta al tope", () => {
    const b = new Budget(1);
    b.add({ prompt_tokens: 1_000_000, completion_tokens: 1_000_000 });
    assert.equal(b.costUsd.toFixed(2), "0.75");
    assert.equal(b.exceeded, false);
    assert.equal(b.canAfford(0.3), false);
    b.add({ prompt_tokens: 2_000_000 });
    assert.equal(b.exceeded, true);
    assert.equal(estimatePerConversation(b, 0), 0.02);
    assert.throws(() => new Budget(0));
  });
  it("ignora usos inválidos", () => {
    const b = new Budget(1);
    b.add(undefined);
    b.add({ prompt_tokens: -5 });
    assert.equal(b.costUsd, 0);
    assert.equal(b.calls, 2);
  });
});

describe("juez", () => {
  const raw = JSON.stringify({
    resuelto: true, derivo: false, invento_precios: false, empatia: 4, no_entendidas: ["la napo"],
    fallas: [falla, { tipo: "inventado", motivo: "x" }],
    sugerencias: [{ categoria: "vocabulario", tema: "la napo", contenido: "Napolitana grande", evidencia: "quiero la napo" }, { categoria: "secreto", tema: "x", contenido: "y" }],
  });
  it("valida y descarta fallas o sugerencias inválidas", () => {
    const v = parseVerdict(`texto antes ${raw} después`, { type: "jerga_errores", mustHandoff: false });
    assert.ok(v);
    assert.equal(v.fallas.length, 1);
    assert.equal(v.fallas[0].escenario, "jerga_errores");
    assert.equal(v.sugerencias.length, 1);
    assert.equal(v.exito, true);
  });
  it("una queja sin derivar no es éxito aunque diga resuelto", () => {
    assert.equal(parseVerdict(raw, { type: "queja_reclamo", mustHandoff: true })?.exito, false);
  });
  it("el mensaje fijo de error y las respuestas vacías son fallas del bot (no se esconden como entorno)", () => {
    const failureReply = { ...falla, respuesta_mala: "Perdón, tuve un problema para responderte. Ya le avisamos al local" };
    const envByJudge = { ...falla, tipo: "otro", correccion: "Revisar herramienta", causa: "entorno" };
    const raw2 = JSON.stringify({ resuelto: false, derivo: false, invento_precios: false, empatia: 3, fallas: [failureReply, envByJudge, { ...falla, tipo: "tono_frio", correccion: "Sé cálido." }] });
    const v = parseVerdict(raw2, { type: "pedido_cambios", mustHandoff: false });
    assert.ok(v);
    // Sin [sim] en los logs, "entorno" no alcanza: las tres cuentan como del bot.
    assert.equal(v.fallas.length, 3);
    assert.equal(v.fallasEntorno.length, 0);
    assert.equal(v.entorno, false);
    assert.equal(v.exito, false);
  });
  it("con un error real de la simulación ([sim]) la falla de entorno no se aprende ni cuenta", () => {
    const env = { ...falla, tipo: "otro", correccion: "x", causa: "entorno" };
    const v = parseVerdict(JSON.stringify({ resuelto: false, derivo: false, invento_precios: false, empatia: 3, fallas: [env] }), { type: "pedido_cambios", mustHandoff: false }, true);
    assert.equal(v?.fallas.length, 0);
    assert.equal(v?.fallasEntorno.length, 1);
    assert.equal(v?.entorno, true);
  });
  it("los hechos observados ganan: si derivó, no hay 'no_derivo' y la queja queda resuelta", () => {
    const raw3 = JSON.stringify({ resuelto: false, derivo: false, invento_precios: false, empatia: 4, fallas: [{ ...falla, tipo: "no_derivo" }, { ...falla, correccion: "x", causa: "cliente" }] });
    const v = parseVerdict(raw3, { type: "queja_reclamo", mustHandoff: true }, false, { handedOff: true });
    assert.equal(v?.derivo, true);
    assert.equal(v?.fallas.length, 0);
    assert.equal(v?.exito, true);
  });
  it("'no_derivo' no cuenta en escenarios que no requieren derivar", () => {
    const v = parseVerdict(JSON.stringify({ resuelto: true, derivo: false, invento_precios: false, empatia: 5, fallas: [{ ...falla, tipo: "no_derivo" }] }), { type: "pedido_cambios", mustHandoff: false });
    assert.equal(v?.fallas.length, 0);
    assert.equal(v?.exito, true);
  });
  it("cliente simulado que no completó su objetivo: fuera de la tasa solo si el bot no falló", () => {
    const base = { resuelto: false, derivo: false, invento_precios: false, empatia: 4, cliente_incompleto: true };
    const sinFalla = parseVerdict(JSON.stringify({ ...base, fallas: [] }), { type: "cancelacion", mustHandoff: false });
    assert.equal(sinFalla?.entorno, true);
    assert.equal(sinFalla?.clienteIncompleto, true);
    const conFalla = parseVerdict(JSON.stringify({ ...base, fallas: [falla] }), { type: "cancelacion", mustHandoff: false });
    assert.equal(conFalla?.entorno, false);
    assert.equal(conFalla?.clienteIncompleto, false);
  });
  it("detecta solo errores propios de la simulación en los logs", () => {
    assert.equal(environmentSignals(['[whatsapp-bot] respuesta bloqueada {"empty":true}']), false);
    assert.equal(environmentSignals(["[sim] el mundo simulado falló"]), true);
    assert.equal(environmentSignals([]), false);
  });
  it("JSON roto o incompleto → null", () => {
    assert.equal(parseVerdict("nada", { type: "x" as never, mustHandoff: false }), null);
    assert.equal(parseVerdict('{"resuelto":true}', { type: "x" as never, mustHandoff: false }), null);
  });
  it("deduplica por clave normalizada", () => {
    const d = dedupeFailures([falla, { ...falla, correccion: "ANTE una queja, empatizá y derivá a una persona!!" }]);
    assert.equal(d.length, 1);
    assert.equal(d[0].veces, 2);
    const s = dedupeSuggestions([
      { categoria: "vocabulario", tema: "La Napo", contenido: "a" },
      { categoria: "vocabulario", tema: "la napo", contenido: "b" },
      { categoria: "faq", tema: "la napo", contenido: "c" },
    ]);
    assert.equal(s.length, 2);
  });
  it("normaliza acentos y signos", () => {
    assert.equal(normalizeKey("  ¿Tenés SIN-TACC? "), "tenes sin tacc");
  });
});

describe("juez: precios medidos en el código", () => {
  const menuPrices = [1800, 3500, 12500, 1500, 10000];
  it("el resumen y el pago son plantillas: sus totales no cuentan como inventados", () => {
    const tr = [
      { role: "bot" as const, text: "Resumen de tu pedido:\n• 2 x Empanada — $3.600\nTotal: $8.600" },
      { role: "bot" as const, text: "¡Listo! Para confirmar tu pedido por $8.600 pagá acá" },
      { role: "bot" as const, text: "La muzza sale $12.500 y la coca $3.500." },
    ];
    assert.equal(inventedPrices(tr, menuPrices), false);
    assert.equal(inventedPrices([{ role: "bot", text: "La coca sale $350." }], menuPrices), true);
  });
  it("si el código no vio montos inventados, se descarta el 'precio_inventado' del juez", () => {
    const raw = JSON.stringify({ resuelto: true, derivo: false, invento_precios: true, empatia: 4, fallas: [{ ...falla, tipo: "precio_inventado" }] });
    const v = parseVerdict(raw, { type: "pedido_cambios", mustHandoff: false }, false, { pricesInvented: false });
    assert.equal(v?.inventoPrecios, false);
    assert.equal(v?.fallas.length, 0);
    assert.equal(v?.exito, true);
    const v2 = parseVerdict(raw, { type: "pedido_cambios", mustHandoff: false }, false, { pricesInvented: true });
    assert.equal(v2?.exito, false);
  });
});

describe("juez: pago acreditado en el mundo", () => {
  it("'confirmado sin pago' se descarta si Mercado Pago acreditó el pago", () => {
    const f = { ...falla, tipo: "no_resolvio", motivo: "El bot confirma el pedido sin que se haya acreditado el pago previamente." };
    const raw = JSON.stringify({ resuelto: false, derivo: false, invento_precios: false, empatia: 4, fallas: [f] });
    const ok = parseVerdict(raw, { type: "jerga_errores", mustHandoff: false }, false, { paymentAccredited: true });
    assert.equal(ok?.fallas.length, 0);
    const sinPago = parseVerdict(raw, { type: "jerga_errores", mustHandoff: false }, false, { paymentAccredited: false });
    assert.equal(sinPago?.fallas.length, 1);
  });
});

describe("cliente simulado", () => {
  it("parsea el próximo mensaje o el fin", () => {
    assert.deepEqual(parseClientTurn('{"mensaje":"hola","fin":false}'), { message: "hola", done: false, parsed: true });
    assert.equal(parseClientTurn('{"mensaje":"","fin":true}').done, true);
    assert.equal(parseClientTurn("roto").done, true);
    assert.equal(parseClientTurn("roto").parsed, false);
  });
});

describe("informe y SQL de pendientes", () => {
  const scenario = generateScenarios(1)[0];
  const verdict = parseVerdict(JSON.stringify({ resuelto: true, derivo: false, invento_precios: false, empatia: 5, fallas: [falla] }), scenario);
  it("calcula el éxito por escenario y arma el Markdown", () => {
    const results = [{ scenario, transcript: [], verdict }, { scenario, transcript: [], verdict: null, error: "x" }];
    assert.deepEqual(successByType(results), [{ type: scenario.type, total: 1, ok: 1 }]);
    const md = renderReport({ requested: 2, results, costUsd: 0.1, inputTokens: 1, outputTokens: 2, limitUsd: 3, stoppedByBudget: true, dateIso: "2026-11-16T10:00:00Z" });
    assert.match(md, /cortó por presupuesto/);
    assert.match(md, /Ante una queja/);
  });
  it("el SQL escapa comillas y nunca aprueba", () => {
    const sql = exportPendingSql([{ ...falla, mensaje_cliente: "it's", veces: 2 }], [], () => "id-1");
    assert.match(sql, /'it''s'/);
    assert.doesNotMatch(sql, /aprobada/);
    assert.match(sql, /veces = veces \+ excluded\.veces/);
  });
});

describe("kb_errores y kb_sugerencias en D1", () => {
  let db: ReturnType<typeof createTestDb>;
  beforeEach(() => {
    db = createTestDb();
    seed(db);
  });

  it("solo staff/sistema escribe y lee", async () => {
    await assert.rejects(recordError(db, actors.ana, "e1", falla), ForbiddenError);
    await assert.rejects(listSugerencias(db, actors.rep1), ForbiddenError);
  });

  it("la misma falla suma veces; queda pendiente y no llega al bot hasta aprobarla", async () => {
    await recordError(db, sys, "e1", falla);
    await recordError(db, sys, "e2", { ...falla, mensaje_cliente: "otra" });
    const [row] = await listErrores(db, actors.admin);
    assert.equal(row.veces, 2);
    assert.equal(row.estado, "pendiente");
    assert.equal(row.id, "e1");
    assert.deepEqual(await d1BotRepo(db).lessons!(), []);

    assert.equal(await decide(db, actors.admin, { tipo: "error", id: "e1", accion: "aprobar" }, () => "x"), true);
    assert.deepEqual(await d1BotRepo(db).lessons!(), [falla.correccion]);
    assert.equal((await regressionCases(db, sys)).length, 1);
    await setRegressionResult(db, sys, "e1", true);
    assert.equal((await listErrores(db, actors.admin))[0].ultima_prueba, "ok");

    await decide(db, actors.admin, { tipo: "error", id: "e1", accion: "desactivar" }, () => "x");
    assert.deepEqual(await d1BotRepo(db).lessons!(), []);
    assert.equal(errorKey(falla), errorKey({ ...falla, correccion: falla.correccion.toUpperCase() }));
  });

  it("aprobar una sugerencia la copia activa a kb_negocio; rechazar no", async () => {
    await recordSugerencia(db, sys, "s1", { categoria: "vocabulario", tema: "la napo", contenido: "Napolitana grande" });
    await recordSugerencia(db, sys, "s2", { categoria: "faq", tema: "¿Hay sin TACC?", contenido: "Sí" });
    assert.equal(await decide(db, actors.admin, { tipo: "sugerencia", id: "s1", accion: "aprobar" }, () => "kb-1"), true);
    assert.equal(await decide(db, actors.admin, { tipo: "sugerencia", id: "s1", accion: "aprobar" }, () => "kb-2"), false);
    assert.equal(await decide(db, actors.admin, { tipo: "sugerencia", id: "s2", accion: "rechazar" }, () => "x"), true);
    assert.equal(await decide(db, actors.admin, { tipo: "sugerencia", id: "s2", accion: "desactivar" }, () => "x"), false);
    const kb = await listKb(db, actors.admin);
    assert.deepEqual(kb.map((k) => [k.id, k.tema, k.activo]), [["kb-1", "la napo", true]]);
    await assert.rejects(decide(db, actors.ana, { tipo: "error", id: "e1", accion: "aprobar" }, () => "x"), ForbiddenError);
  });

  it("valida la decisión del admin", () => {
    assert.equal(decisionSchema.safeParse({ tipo: "error", id: "e1", accion: "borrar" }).success, false);
    assert.equal(decisionSchema.safeParse({ tipo: "error", id: "e1", accion: "aprobar", extra: 1 }).success, false);
  });
});

describe("mundo local + processTurn real (modelo falso, sin OpenAI)", () => {
  it("siembra el menú, cotiza con pedidos falsos y deriva una queja", async () => {
    const db = openSimDb(":memory:");
    seedWorld(db);
    assert.match(menuText(db), /Napolitana grande: \$14\.500/);
    const orders = fakeOrders(db);
    const quote = await orders.quote({ conversationId: "c", inboundWamid: "w", items: [{ product_id: simProductId(0), qty: 2 }], address: "Palermo 123" });
    assert.ok(quote.ok && quote.data.total === 26500);
    // Regresión del entorno: los ids del menú de ejemplo pasan la validación real de quote_order.
    assert.ok(parseQuoteArgs({ items: [{ product_id: simProductId(0), qty: 1 }], address: "Palermo 123" }));
    assert.equal((await orders.confirm({ conversationId: "otra", inboundWamid: "w", payment_method: "Mercado Pago" })).ok, false);

    const inbound = d1InboundRepo(db);
    const repo = d1BotRepo(db);
    const conv = await inbound.upsertConversation("5491170000001", "Laura");
    await inbound.saveInbound(conv.id, { wamid: "in-1", type: "text", body: "es una vergüenza, llegó fría" });
    const sent: string[] = [];
    const run = async (_m: string, input: Record<string, unknown>) =>
      "response_format" in input ? { response: '{"intent":"humano","confidence":0.9}' } : { response: "x" };
    await processTurn(
      { phone: "5491170000001", text: "es una vergüenza, llegó fría", wamids: ["in-1"], audios: [], receivedAt: 0 },
      { repo, run, transcribe: async () => null, send: async (_p, t) => { sent.push(t); return `o-${sent.length}`; }, appUrl: "https://opsyndely.la-gambeta.com", orders, log: () => {} },
    );
    assert.equal(sent.length, 1);
    assert.equal((await repo.getConversation("5491170000001"))?.humanTakeover, true);
  });
});

describe("lecciones en el prompt", () => {
  it("máximo 20, una línea, debajo de las reglas fijas", () => {
    const many = Array.from({ length: 25 }, (_, i) => `Lección\n${i} """`);
    const lines = lessonLines(many);
    assert.equal(lines.length, 20);
    assert.ok(lines.every((l) => !l.includes("\n") && !l.includes('"""')));
    const prompt = buildResponderPrompt(settingsFromConfig({}), "saludo", null, false, [], ["No inventes promos."]);
    assert.ok(prompt.indexOf("Errores a evitar") > prompt.indexOf("Reglas:"));
    assert.match(prompt, /- No inventes promos\./);
    assert.doesNotMatch(buildResponderPrompt(settingsFromConfig({}), "saludo", null, false), /Errores a evitar/);
  });
});
