/** No inventar (entrega 2): regla del prompt y derivación de las consultas del local que el bot no puede responder. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResponderPrompt, CONSULTA_RULE } from "../workers/whatsapp-bot/src/bot/prompts.ts";
import { settingsFromConfig } from "../workers/whatsapp-bot/src/bot/settings.ts";
import { consultaText, processTurn, type TurnDeps } from "../workers/whatsapp-bot/src/bot/turn.ts";
import { consultaReply, CONSULTA_PREFIX } from "../workers/whatsapp-bot/src/bot/complaints.ts";
import { isConsultaReason, toolsFor } from "../workers/whatsapp-bot/src/bot/tools.ts";
import type { BotRepo, ComplaintInput, ComplaintTicket } from "../workers/whatsapp-bot/src/repo/types.ts";

const OPEN = { agente_activo: true, horario_apertura: "00:00", horario_cierre: "23:59" };
const CLOSED = { horario_apertura: "03:00", horario_cierre: "03:01" };
const REGLA = "Antes de responder sobre el local, verificá con las herramientas (carta, precios, horarios, zonas, get_business_info). Si la información no aparece, no la supongas: decí que lo consultás con el local y derivá con handoff_to_human con motivo 'consulta'";

describe("prompt: regla de no inventar", () => {
  it("todas las intenciones llevan la regla, con el local abierto o cerrado", () => {
    for (const config of [OPEN, { ...OPEN, ...CLOSED }]) {
      for (const intent of ["consulta_local", "consulta_menu", "saludo", "otro", "pedido_estado"] as const) {
        const prompt = buildResponderPrompt(settingsFromConfig(config), intent, null, false);
        assert.ok(prompt.includes(REGLA), `${intent}: falta la regla`);
      }
    }
    assert.ok(CONSULTA_RULE.includes(REGLA));
  });

  it("con pedidos encendidos la regla también está en las intenciones de pedido", () => {
    const settings = settingsFromConfig({ ...OPEN, bot_orders_enabled: true });
    for (const intent of ["pedido_nuevo", "pedido_datos", "pedido_confirmar"] as const) {
      assert.ok(buildResponderPrompt(settings, intent, null, false).includes(REGLA), intent);
    }
  });

  it("cerrado agrega que no se promete una persona; abierto no", () => {
    const closed = buildResponderPrompt(settingsFromConfig({ ...OPEN, ...CLOSED }), "consulta_local", null, false);
    assert.match(closed, /Con el local CERRADO, una consulta sin respuesta también se deriva con handoff_to_human/);
    assert.match(closed, /a las 03:00/);
    const open = buildResponderPrompt(settingsFromConfig(OPEN), "consulta_local", null, false);
    assert.doesNotMatch(open, /Con el local CERRADO/);
  });

  it("derivar una consulta sin respuesta es la excepción a «no ofrezcas una persona»", () => {
    for (const config of [OPEN, { ...OPEN, ...CLOSED }]) {
      const prompt = buildResponderPrompt(settingsFromConfig(config), "consulta_local", null, false);
      assert.match(prompt, /No ofrezcas hablar con una persona si el cliente no se queja ni lo pide; la única excepción es una consulta sobre el local/);
    }
  });
});

const CONVERSATION = { id: "c1", phone: "5491170000001", clientId: "cl1", displayName: "Ana", humanTakeover: false };

describe("herramienta handoff_to_human: consulta o reclamo", () => {
  const run = async (reason: unknown, config: Record<string, unknown> = OPEN) => {
    const calls: ComplaintInput[] = [];
    const repo = { zones: async () => [], menu: async () => [], createComplaint: async (c: ComplaintInput) => (calls.push(c), null) } as unknown as BotRepo;
    const tool = toolsFor("consulta_local", repo, CONVERSATION, settingsFromConfig(config)).find((t) => t.name === "handoff_to_human")!;
    return { calls, out: (await tool.run({ reason })) as { ok: boolean; ticket: boolean; note: string }, tool };
  };

  it("el motivo «consulta: ...» registra una consulta; cualquier otro, un reclamo", async () => {
    assert.equal((await run("consulta: ¿hacen pizza sin gluten?")).calls[0]!.kind, "consulta");
    assert.equal((await run("  Consulta sobre cumpleaños")).calls[0]!.kind, "consulta");
    assert.equal((await run("llegó frío")).calls[0]!.kind, "reclamo");
    assert.equal((await run("")).calls[0]!.kind, "reclamo");
    assert.equal((await run(undefined)).calls[0]!.kind, "reclamo");
    assert.equal(isConsultaReason("consultoría"), false, "solo la palabra completa");
  });

  it("el aviso al modelo no habla de reclamo y respeta el local cerrado", async () => {
    const open = (await run("consulta: sin gluten")).out;
    assert.match(open.note, /consulta quedó registrada/);
    assert.doesNotMatch(open.note, /reclamo/i);
    const closed = (await run("consulta: sin gluten", { ...OPEN, ...CLOSED })).out;
    assert.match(closed.note, /NO digas que te atiende una persona/);
    assert.match(closed.note, /03:00/);
  });

  it("la descripción explica cuándo usarla para una consulta", async () => {
    const { tool } = await run("x");
    assert.match(tool.description, /consulta sobre el local que no pudiste responder/);
    assert.match(tool.description, /«consulta:»/);
  });
});

describe("turno: consulta sin respuesta", () => {
  function world(config: Record<string, unknown>, reason = "consulta: si hacen pizza sin gluten") {
    const sent: string[] = [];
    const complaints: ComplaintInput[] = [];
    const logs: unknown[] = [];
    const state = { takeover: false };
    let open: ComplaintTicket | null = null;
    const repo: BotRepo = {
      getConversation: async (phone) => ({ ...CONVERSATION, phone, humanTakeover: state.takeover }),
      history: async () => [{ direction: "in", body: "hola" }],
      inboundCounts: async () => ({ lastMinute: 1, lastDay: 1 }),
      config: async () => ({ ...OPEN, negocio_nombre: "La Gambeta", ...config }),
      menu: async () => [],
      zones: async () => [],
      latestOrder: async () => null,
      setTakeover: async () => { state.takeover = true; },
      setMarketingOptIn: async () => 1,
      saveOutbound: async (_c, _w, body) => { sent.push(body); },
      saveTranscript: async () => {},
      lastOutboundAt: async () => new Date(),
      searchKnowledge: async () => [],
      createComplaint: async (c) => {
        complaints.push(c);
        if (open) return { ...open, created: false };
        open = { id: "r1", numero: 9, created: true, categoria: c.categoria ?? "otro", orderId: c.orderId ?? null, fotos: 0, createdAt: new Date() };
        return open;
      },
      openComplaint: async () => open,
    };
    const run: TurnDeps["run"] = async (_m, input) => {
      if ("response_format" in input) return { response: JSON.stringify({ intent: "consulta_local", confidence: 0.95 }) };
      const used = (input.messages as { role: string }[]).some((m) => m.role === "tool");
      return used ? { response: "Perdón, no sé." } : { tool_calls: [{ name: "handoff_to_human", arguments: { reason } }] };
    };
    let n = 0;
    const deps: TurnDeps = { repo, run, transcribe: async () => null, send: async () => `o-${++n}`, appUrl: "https://opsyndely.la-gambeta.com", log: (m, d) => logs.push([m, d]) };
    const send = (text: string) => processTurn({ phone: CONVERSATION.phone, text, wamids: ["w1"], audios: [], receivedAt: 0 }, deps);
    return { send, sent, complaints, state, logs };
  }

  it("abierto: registra el ticket como consulta, pasa a una persona y avisa sin hablar de reclamo", async () => {
    const w = world(OPEN);
    assert.equal(await w.send("¿hacen pizza sin gluten?"), "ticket");
    assert.equal(w.state.takeover, true);
    assert.equal(w.complaints.length, 1);
    assert.equal(w.complaints[0]!.categoria, "otro");
    assert.equal(w.complaints[0]!.orderId, null);
    assert.equal(w.complaints[0]!.motivo, `${CONSULTA_PREFIX}¿hacen pizza sin gluten?\nsi hacen pizza sin gluten`);
    assert.equal(w.sent.length, 1);
    assert.equal(w.sent[0], consultaReply("abierto", "00:00"));
    assert.doesNotMatch(w.sent[0]!, /reclamo|mal momento|perdón/i);
  });

  it("cerrado: queda registrada, no silencia al bot y avisa cuándo responden", async () => {
    const w = world({ ...OPEN, ...CLOSED });
    assert.equal(await w.send("¿hacen pizza sin gluten?"), "ticket");
    assert.equal(w.state.takeover, false);
    assert.equal(w.complaints.length, 1);
    assert.match(w.complaints[0]!.motivo, /^Consulta sin respuesta: /);
    assert.equal(w.sent[0], "Lo consulto con el local y te respondemos cuando abramos, a las 03:00.");
  });

  it("entrenamiento: registra la consulta pero no pasa a una persona, ni con el local abierto", async () => {
    const w = world({ ...OPEN, bot_modo_entrenamiento: true });
    assert.equal(await w.send("¿hacen pizza sin gluten?"), "ticket");
    assert.equal(w.state.takeover, false);
    assert.equal(w.complaints.length, 1);
    assert.match(w.sent[0]!, /apenas tengamos la respuesta/);
  });

  it("un reclamo (motivo sin «consulta») sigue el flujo de siempre: reclamo con número", async () => {
    const w = world({ ...OPEN, ...CLOSED }, "pedido incompleto");
    assert.equal(await w.send("me faltó una pizza"), "ticket");
    assert.match(w.sent[0]!, /reclamo #9/);
    assert.equal(w.complaints[0]!.categoria, "faltante");
    assert.doesNotMatch(w.complaints[0]!.motivo, /^Consulta sin respuesta/);
  });
});

describe("texto de la consulta", () => {
  it("guarda lo que escribió el cliente y el detalle del modelo sin el «consulta:» inicial ni repetidos", () => {
    assert.equal(consultaText("¿hacen sin gluten?", "consulta: pizza sin gluten"), "¿hacen sin gluten?\npizza sin gluten");
    assert.equal(consultaText("¿hacen sin gluten?", "Consulta - "), "¿hacen sin gluten?");
    assert.equal(consultaText("sin gluten", "consulta: sin gluten"), "sin gluten");
  });
});
