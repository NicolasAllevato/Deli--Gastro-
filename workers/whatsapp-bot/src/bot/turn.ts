/**
 * Fase 4: un turno agrupado por el apilador → una sola respuesta.
 * Orden: humano a cargo → límites → audios → ALTA/BAJA → guardrail de entrada → clasificador →
 * respondedor con herramientas de su intención → guardrail de salida → envío y registro.
 */
import { classify, MIN_CONFIDENCE, type Intent } from "../ai/classifier.ts";
import { respond } from "../ai/responder.ts";
import type { ChatMessage, RunModel } from "../ai/models.ts";
import { audioPlaceholder } from "../batching.ts";
import type { InboundTurn } from "../turn-types.ts";
import { inspectInbound, inspectOutbound, wrapUntrusted } from "../guardrails.ts";
import type { BotConversation, BotRepo } from "../repo/types.ts";
import { detectKeyword } from "../../../../src/lib/whatsapp/keywords.ts";
import { decideInboundLimit } from "../../../../src/lib/agent/limits.ts";
import { buildResponderPrompt, orderReply, REPLIES } from "./prompts.ts";
import { settingsFromConfig, type BotSettings } from "./settings.ts";
import { toolsFor } from "./tools.ts";
import type { OrdersClient } from "../orders/client.ts";
import { withPrivacy } from "../privacy.ts";
import {
  cancelAfterPrompt, claimsOrderState, confirmAfterSummary, disabledReply, imitatesTemplate, isAffirmation, isOutsidePilot, newOrderState, ORDER_REPLIES,
  asksCancelConfirmation, CANCEL_PROMPT, PRICE_SAFE_REPLY, unknownPrices, promisesLater, trailingQuestion,
  lastDecisiveBotMessage, QUOTE_MARKER, pendingOperation, runCancel, type OrderTurn,
} from "../orders/flow.ts";

export interface TurnDeps {
  repo: BotRepo;
  run: RunModel;
  /** Descarga y transcribe un audio de WhatsApp; null si no se pudo. */
  transcribe: (mediaId: string) => Promise<string | null>;
  /** Envía un texto por la Cloud API y devuelve el wamid. */
  send: (phone: string, text: string) => Promise<string>;
  /** URL pública de la app (links permitidos en las respuestas). */
  appUrl: string;
  /** Cliente firmado de los endpoints de pedidos; sin él (o con el flag apagado) los pedidos se derivan a la web. */
  orders?: OrdersClient;
  log: (message: string, detail?: unknown) => void;
}

export type TurnOutcome =
  | "takeover" | "inactive" | "rate_silent" | "rate_notify" | "keyword"
  | "blocked" | "unclear" | "order_redirect" | "answered" | "output_blocked" | "no_conversation" | "empty";

const HISTORY_TURNS = 8;
const ORDER_INTENTS: readonly Intent[] = ["pedido_nuevo", "pedido_datos", "pedido_confirmar", "pedido_cancelar"];
const ALLOWED_HOSTS = ["mpago.la", "mercadopago.com.ar", "google.com", "maps.google.com"];

/** Una persona escribió desde la app mientras se preparaba la respuesta: el turno se aborta sin enviar nada. */
class PausedMidTurn extends Error {}

/**
 * Envía y guarda la respuesta. Antes de enviar vuelve a leer la conversación: un eco de la app WhatsApp Business
 * puede haber pausado el bot mientras el modelo pensaba. `recheck: false` solo para el aviso de traspaso a una persona.
 */
async function reply(deps: TurnDeps, conversation: BotConversation, text: string, recheck = true): Promise<void> {
  if (recheck && (await deps.repo.getConversation(conversation.phone))?.humanTakeover) throw new PausedMidTurn();
  const wamid = await deps.send(conversation.phone, text);
  // Se guarda en wa_messages: el panel muestra lo que respondió el bot (coexistencia).
  await deps.repo.saveOutbound(conversation.id, wamid, text);
}

/** Reemplaza cada `[audio:<wamid>]` por su transcripción (y la guarda para el panel). */
async function resolveAudios(turn: InboundTurn, deps: TurnDeps, settings: BotSettings): Promise<string | null> {
  let text = turn.text;
  for (const audio of turn.audios) {
    const heard = settings.transcribeAudio ? await deps.transcribe(audio.mediaId).catch(() => null) : null;
    if (!heard) return null;
    await deps.repo.saveTranscript(audio.wamid, heard);
    text = text.replace(audioPlaceholder(audio.wamid), `[audio] ${heard}`);
  }
  return text;
}

function historyMessages(items: { direction: "in" | "out"; body: string }[]): ChatMessage[] {
  return items.map((m) => (m.direction === "in" ? { role: "user", content: wrapUntrusted(m.body) } : { role: "assistant", content: m.body }));
}

/** Por qué se descartó un borrador del modelo (y qué se le corrige en el reintento). */
type DraftIssue = "empty" | "template" | "state" | "price" | "promise" | "blocked";

const RETRY_HINT: Record<DraftIssue, string> = {
  empty: "Tu respuesta anterior quedó vacía. Respondé ahora al cliente en 1 a 3 líneas.",
  template: "No escribas resúmenes de pedido ni pidas que respondan SÍ: para cotizar llamá quote_order y el sistema manda el resumen.",
  state: "No digas que el pedido está confirmado, pagado o en camino: eso lo informa solo el sistema.",
  price: "No escribas montos calculados por vos: usá price_text/total_text tal cual o llamá quote_order.",
  promise: "No prometas hacerlo después ni digas «un momento»: hacelo ahora con las herramientas o decí qué dato falta.",
  blocked: "Tu respuesta anterior tenía datos que no se pueden mandar. Respondé de nuevo sin datos personales ni links.",
};

/** Reemplazo cálido cuando el modelo insiste en afirmar el estado del pedido (no afirma nada que no sepa el sistema). */
const ORDER_STATE_SOFT_REPLY =
  "¡Genial! 🙌 Apenas se acredite el pago con Mercado Pago tu pedido sale. Si querés saber cómo va, preguntame y te cuento.";

const SAFE_FALLBACK: Record<DraftIssue, string> = {
  empty: REPLIES.failure,
  template: ORDER_REPLIES.startOver,
  state: ORDER_STATE_SOFT_REPLY,
  price: PRICE_SAFE_REPLY,
  promise: ORDER_REPLIES.startOver,
  blocked: REPLIES.failure,
};

async function draftIssue(draft: string, intent: Intent, conversation: BotConversation, deps: TurnDeps, order?: OrderTurn): Promise<DraftIssue | null> {
  if (!draft.trim()) return "empty";
  if (order && imitatesTemplate(draft)) return "template";
  if (intent !== "pedido_estado" && claimsOrderState(draft)) return "state";
  if (draft.includes("$")) {
    const [menu, zones] = await Promise.all([deps.repo.menu(), deps.repo.zones()]);
    const allowed = [...menu.map((p) => p.price), ...zones.flatMap((z) => [z.fee, z.minOrder])];
    if (unknownPrices(draft, allowed).length > 0) return "price";
  }
  if (promisesLater(draft)) return "promise";
  const appHost = new URL(deps.appUrl).host;
  const check = withPrivacy(draft, inspectOutbound(draft, { customerPhone: conversation.phone, allowedHosts: [appHost, ...ALLOWED_HOSTS] }));
  return check.verdict === "block" ? "blocked" : null;
}

async function answer(
  turnText: string, intent: Intent, suspicious: boolean, conversation: BotConversation, settings: BotSettings, deps: TurnDeps, order?: OrderTurn,
): Promise<TurnOutcome> {
  // Los entrantes del final son este mismo turno (ya guardados por la entrada): van como userText, no como historial.
  const history = await deps.repo.history(conversation.id, HISTORY_TURNS + 5);
  while (history.at(-1)?.direction === "in") history.pop();
  const knowledge = (await deps.repo.knowledge?.().catch(() => [])) ?? [];
  const lessons = (await deps.repo.lessons?.().catch(() => [])) ?? [];
  // Si el modelo deriva con handoff_to_human en ESTE turno, su mensaje al cliente igual sale (sin el rechequeo
  // de pausa, que si no aborta el envío y el cliente se queda sin respuesta).
  let handedOffNow = false;
  const toolRepo = {
    ...deps.repo,
    setTakeover: async (id: string) => {
      handedOffNow = true;
      await deps.repo.setTakeover(id);
    },
  };
  const system = buildResponderPrompt(settings, intent, conversation.displayName, suspicious, knowledge, lessons);
  const tools = suspicious ? [] : toolsFor(intent, toolRepo, conversation, settings, Date.now, order);
  const ask = (extra?: string) =>
    respond(deps.run, { system: extra ? `${system}\n\nCORRECCIÓN: ${extra}` : system, history: historyMessages(history), userText: wrapUntrusted(turnText), tools });

  let draft = await ask();
  let issue: DraftIssue | null = null;
  // Un reintento con la corrección: el cliente no recibe el mensaje genérico si el modelo lo puede arreglar.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Pedidos: lo que ve el cliente (resumen, link de pago, errores) es una plantilla fija, no el texto del modelo.
    if (order?.state.fixedReply) {
      await reply(deps, conversation, order.state.fixedReply, !order.state.handedOff && !handedOffNow);
      return "answered";
    }
    // El modelo preguntó a mano si cancela (en vez de cancel_order): se manda la plantilla oficial, que habilita el SÍ.
    // Pasa por runCancel: primero se mira el pedido (sin pedido, resumen sin confirmar o ya en preparación no se pregunta).
    if (order && intent === "pedido_cancelar" && asksCancelConfirmation(draft)) {
      await runCancel(order, { confirmed: false });
      await reply(deps, conversation, order.state.fixedReply ?? CANCEL_PROMPT, !order.state.handedOff);
      return "answered";
    }
    issue = await draftIssue(draft, intent, conversation, deps, order);
    // Sin problemas, o derivó en este turno (sale su mensaje si es válido, si no el aviso de traspaso).
    if (!issue || handedOffNow) break;
    deps.log("[whatsapp-bot] borrador descartado", { conversation: conversation.id, intent, issue, attempt });
    if (attempt === 0) draft = await ask(RETRY_HINT[issue]);
  }

  if (handedOffNow) {
    await reply(deps, conversation, issue ? REPLIES.handoff : draft, false);
    return "answered";
  }
  if (issue) {
    deps.log("[whatsapp-bot] respuesta bloqueada", { conversation: conversation.id, reasons: [issue], empty: issue === "empty" });
    await reply(deps, conversation, SAFE_FALLBACK[issue]);
    if (issue === "empty" || issue === "blocked") await deps.repo.setTakeover(conversation.id);
    return "output_blocked";
  }
  await reply(deps, conversation, draft);
  return "answered";
}

/** Un SÍ con pregunta ("¿cuánto tardan?") recibe la plantilla de pago y además la respuesta a su pregunta. */
function withFollowUp(base: string, text: string, op: "confirm" | "cancel", settings: BotSettings): string {
  if (op !== "confirm" || !base.startsWith("¡Listo! Para confirmar")) return base;
  const q = trailingQuestion(text);
  if (q === "demora") return `${base}\nLa demora estimada es de ${settings.estimatedMinutes} minutos desde que se acredita el pago.`;
  if (q === "otra") return `${base}\nSi tenés otra consulta, escribime y te ayudo.`;
  return base;
}

export async function processTurn(turn: InboundTurn, deps: TurnDeps): Promise<TurnOutcome> {
  try {
    return await runTurn(turn, deps);
  } catch (error: unknown) {
    if (error instanceof PausedMidTurn) return "takeover";
    throw error;
  }
}

async function runTurn(turn: InboundTurn, deps: TurnDeps): Promise<TurnOutcome> {
  const conversation = await deps.repo.getConversation(turn.phone);
  if (!conversation) return "no_conversation";
  if (conversation.humanTakeover) return "takeover";

  const settings = settingsFromConfig(await deps.repo.config());
  if (!settings.active) return "inactive";

  const limit = decideInboundLimit(await deps.repo.inboundCounts(conversation.id));
  if (limit === "silent") return "rate_silent";
  if (limit === "notify") {
    await reply(deps, conversation, REPLIES.rateLimited);
    return "rate_notify";
  }

  const text = await resolveAudios(turn, deps, settings);
  if (text === null) {
    await reply(deps, conversation, REPLIES.audioFailed);
    return "empty";
  }
  if (!text.trim()) return "empty";

  // ALTA/BAJA: solo si el turno entero es la palabra clave (sin IA).
  const keyword = detectKeyword(text);
  if (keyword) {
    await deps.repo.setMarketingOptIn(conversation.phone, keyword === "opt_in");
    await reply(deps, conversation, keyword === "opt_in" ? REPLIES.optIn : REPLIES.optOut);
    return "keyword";
  }

  const inbound = inspectInbound(text);
  if (inbound.verdict === "block") {
    deps.log("[whatsapp-bot] mensaje bloqueado", { conversation: conversation.id, reasons: inbound.reasons });
    await reply(deps, conversation, REPLIES.blocked);
    return "blocked";
  }

  const outNewestFirst = (await deps.repo.history(conversation.id, 8)).filter((m) => m.direction === "out").map((m) => m.body).reverse();
  const lastBot = lastDecisiveBotMessage(outNewestFirst);
  // Resumen vigente: el último mensaje "de sistema" del bot es un resumen (todavía sin link de pago ni cancelación).
  const lastSystem = outNewestFirst.find((b) => b.startsWith(QUOTE_MARKER) || /^¡Listo! Para confirmar|^Listo, (cancelamos|dejamos)/.test(b));
  const recentQuote = lastSystem?.startsWith(QUOTE_MARKER) ?? false;
  const wamid = turn.wamids.at(-1);
  const order: OrderTurn | undefined =
    settings.ordersEnabled && deps.orders && wamid
      ? {
          client: deps.orders, repo: deps.repo, conversation, inboundWamid: wamid, inboundText: text,
          hasAudio: turn.audios.length > 0, lastBotMessage: lastBot, recentQuote, appUrl: deps.appUrl, hours: settings.hours, state: newOrderState(),
        }
      : undefined;

  // Camino determinista: SÍ literal justo después del resumen (o de la pregunta de cancelar) no pasa por el clasificador.
  const pending = pendingOperation(lastBot);
  if (order && pending && isAffirmation(text, pending) && !order.hasAudio) {
    const direct = pending === "confirm" ? confirmAfterSummary : pending === "cancel" ? cancelAfterPrompt : null;
    if (direct) {
      await direct(order);
      const base = order.state.fixedReply ?? REPLIES.failure;
      await reply(deps, conversation, withFollowUp(base, text, pending, settings), !order.state.handedOff);
      return "answered";
    }
  }
  const { intent, confidence } = await classify(deps.run, wrapUntrusted(text), lastBot);

  if (intent === "humano") {
    await deps.repo.setTakeover(conversation.id);
    await reply(deps, conversation, REPLIES.handoff, false);
    return "answered";
  }
  if (confidence < MIN_CONFIDENCE) {
    await reply(deps, conversation, REPLIES.unclear);
    return "unclear";
  }
  if (ORDER_INTENTS.includes(intent) && !order) {
    // Flag apagado (o sin cliente): camino de siempre, derivar a la web.
    await reply(deps, conversation, settings.ordersEnabled ? disabledReply(deps.appUrl) : orderReply(deps.appUrl, settings));
    return "order_redirect";
  }
  // Un número fuera del piloto (allowlist) recibe «no disponible» sin gastar el modelo.
  if (order && (intent === "pedido_nuevo" || intent === "pedido_datos") && (await isOutsidePilot(order))) {
    await reply(deps, conversation, disabledReply(deps.appUrl));
    return "order_redirect";
  }
  return answer(text, intent, inbound.verdict === "suspicious", conversation, settings, deps, order);
}
