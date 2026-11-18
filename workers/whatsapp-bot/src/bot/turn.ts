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
import { buildResponderPrompt, closedTicketReply, isStaleBotMessage, orderReply, profileAddressUnconfirmed, REPLIES } from "./prompts.ts";
import { openNow, settingsFromConfig, type BotSettings } from "./settings.ts";
import { promosForToday, renderGreeting, shouldGreetNow } from "./greeting.ts";
import { asksFullMenu } from "./menu.ts";
import { toolsFor } from "./tools.ts";
import type { OrdersClient } from "../orders/client.ts";
import { withPrivacy } from "../privacy.ts";
import {
  cancelAfterPrompt, claimsOrderState, confirmAfterSummary, disabledReply, imitatesTemplate, isAffirmation, isOutsidePilot, newOrderState, ORDER_REPLIES,
  asksCancelConfirmation, CANCEL_PROMPT, PRICE_SAFE_REPLY, unknownPrices, promisesLater, trailingQuestion,
  lastDecisiveBotMessage, QUOTE_MARKER, CASH_MARKER, PAYMENT_QUESTION, paymentChoice, renderFinalSummary, pendingOperation, runCancel, saysPaid, isClosingMessage, type OrderTurn,
} from "../orders/flow.ts";

export interface TurnDeps {
  repo: BotRepo;
  run: RunModel;
  /** Descarga y transcribe un audio de WhatsApp; null si no se pudo. */
  transcribe: (mediaId: string) => Promise<string | null>;
  /** Envía un texto por la Cloud API y devuelve el wamid. */
  send: (phone: string, text: string) => Promise<string>;
  /** Envía un documento (la carta en PDF) por link público y devuelve el wamid. Sin él no se manda la carta. */
  sendDocument?: (phone: string, url: string, filename: string, caption?: string) => Promise<string>;
  /** URL pública de la app (links permitidos en las respuestas). */
  appUrl: string;
  /** Cliente firmado de los endpoints de pedidos; sin él (o con el flag apagado) los pedidos se derivan a la web. */
  orders?: OrdersClient;
  log: (message: string, detail?: unknown) => void;
}

export type TurnOutcome =
  | "takeover" | "inactive" | "rate_silent" | "rate_notify" | "keyword"
  | "blocked" | "unclear" | "order_redirect" | "answered" | "output_blocked" | "no_conversation" | "empty" | "greeted" | "ticket";

/** Intenciones que en el primer turno reciben SOLO el saludo (con las promos): el pedido arranca en el turno siguiente. */
const GREETING_ONLY: readonly Intent[] = ["saludo", "pedido_nuevo", "otro"];

const HISTORY_TURNS = 8;
const ORDER_INTENTS: readonly Intent[] = ["pedido_nuevo", "pedido_datos", "pedido_confirmar", "pedido_cancelar"];
const ALLOWED_HOSTS = ["mpago.la", "mercadopago.com.ar", "google.com", "maps.google.com"];

/**
 * Queja o pedido de una persona. Abierto: deriva (human_takeover) como siempre. Cerrado: no hay nadie, así que NO se
 * silencia al bot: se registra un ticket de reclamo y se le avisa al cliente cuándo lo contactan.
 */
async function escalate(deps: TurnDeps, conversation: BotConversation, settings: BotSettings, motivo: string, openReply: string): Promise<"answered" | "ticket"> {
  if (!openNow(settings) && deps.repo.createComplaint) {
    await deps.repo.createComplaint({ conversationId: conversation.id, phone: conversation.phone, clientId: conversation.clientId, motivo });
    await reply(deps, conversation, closedTicketReply(settings));
    return "ticket";
  }
  await deps.repo.setTakeover(conversation.id);
  await reply(deps, conversation, openReply, false);
  return "answered";
}

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

/** Historial para el modelo, sin los mensajes viejos del bot que son plantillas obsoletas (no los imita). */
export function historyMessages(items: { direction: "in" | "out"; body: string }[], ordersEnabled = false): ChatMessage[] {
  return items.filter((m) => m.direction === "in" || !isStaleBotMessage(m.body, ordersEnabled)).map((m) => (m.direction === "in" ? { role: "user", content: wrapUntrusted(m.body) } : { role: "assistant", content: m.body }));
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

/** Cuando no se puede contestar bien una consulta por su pedido: empatía y una persona lo revisa. */
const STATUS_HANDOFF_REPLY = "Perdón por la espera 🙏 Te paso con una persona del local para que revise tu pedido ya mismo.";

const SAFE_FALLBACK: Record<DraftIssue, string> = {
  empty: REPLIES.failure,
  template: ORDER_REPLIES.startOver,
  state: ORDER_STATE_SOFT_REPLY,
  price: PRICE_SAFE_REPLY,
  promise: "Cualquier cosa que necesites, escribime y te ayudo 😊",
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
  knownAddress: string | null = null,
): Promise<TurnOutcome> {
  // Los entrantes del final son este mismo turno (ya guardados por la entrada): van como userText, no como historial.
  const history = await deps.repo.history(conversation.id, HISTORY_TURNS + 5);
  while (history.at(-1)?.direction === "in") history.pop();
  const knowledge = (await deps.repo.knowledge?.().catch(() => [])) ?? [];
  const lessons = (await deps.repo.lessons?.().catch(() => [])) ?? [];
  // Perfil del cliente habitual: siempre el de ESTE teléfono (etapa 2). Si falla, se sigue sin perfil.
  const profile = (await deps.repo.customerProfile?.(conversation.phone).catch(() => null)) ?? null;
  const clientTexts = history.filter((h) => h.direction === "in").map((h) => h.body);
  const lastBot = history.filter((h) => h.direction === "out").at(-1)?.body ?? null;
  const guard = (address: string) => profileAddressUnconfirmed(address, profile?.lastAddress, clientTexts, lastBot, turnText);
  // Si el modelo deriva con handoff_to_human en ESTE turno, su mensaje al cliente igual sale (sin el rechequeo
  // de pausa, que si no aborta el envío y el cliente se queda sin respuesta).
  let handedOffNow = false;
  let ticketNow = false;
  const createComplaint = deps.repo.createComplaint;
  const toolRepo = {
    ...deps.repo,
    setTakeover: async (id: string) => {
      handedOffNow = true;
      await deps.repo.setTakeover(id);
    },
    ...(createComplaint
      ? {
          createComplaint: async (input: Parameters<typeof createComplaint>[0]) => {
            ticketNow = true;
            await createComplaint(input);
          },
        }
      : {}),
  };
  const system = buildResponderPrompt(settings, intent, conversation.displayName ?? profile?.name ?? null, suspicious, knowledge, lessons, profile);
  const tools = suspicious ? [] : toolsFor(intent, toolRepo, conversation, settings, Date.now, order, guard);
  const ask = (extra?: string) =>
    respond(deps.run, { system: extra ? `${system}\n\nCORRECCIÓN: ${extra}` : system, history: historyMessages(history, settings.ordersEnabled), userText: wrapUntrusted(turnText), tools });

  let draft = await ask();
  let issue: DraftIssue | null = null;
  // Un reintento con la corrección: el cliente no recibe el mensaje genérico si el modelo lo puede arreglar.
  for (let attempt = 0; attempt < 2; attempt++) {
    // Local cerrado y el modelo registró un reclamo: aviso fijo (sin prometer una persona).
    if (ticketNow) {
      await reply(deps, conversation, closedTicketReply(settings));
      return "ticket";
    }
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
    const hint = issue === "promise" && order && knownAddress
      ? `${RETRY_HINT.promise} Si quiere pedir, llamá quote_order YA con los product_id de get_menu y la dirección "${knownAddress}".`
      : RETRY_HINT[issue];
    if (attempt === 0) draft = await ask(hint);
  }

  if (handedOffNow) {
    await reply(deps, conversation, issue ? REPLIES.handoff : draft, false);
    return "answered";
  }
  // Consulta por su pedido que el modelo no pudo contestar sin prometer: una persona lo revisa ya (no un saludo vacío).
  if (ticketNow) {
    await reply(deps, conversation, closedTicketReply(settings));
    return "ticket";
  }
  if (issue && intent === "pedido_estado") {
    deps.log("[whatsapp-bot] respuesta bloqueada", { conversation: conversation.id, reasons: [issue], handoff: true });
    const done = await escalate(deps, conversation, settings, turnText, STATUS_HANDOFF_REPLY);
    return done === "ticket" ? "ticket" : "output_blocked";
  }
  if (issue) {
    deps.log("[whatsapp-bot] respuesta bloqueada", { conversation: conversation.id, reasons: [issue], empty: issue === "empty" });
    const orderIntent = intent === "pedido_nuevo" || intent === "pedido_datos" || intent === "pedido_confirmar";
    await reply(deps, conversation, issue === "promise" && orderIntent ? ORDER_REPLIES.startOver : SAFE_FALLBACK[issue]);
    // Cerrado no hay quien tome la charla: no se silencia al bot.
    if ((issue === "empty" || issue === "blocked") && openNow(settings)) await deps.repo.setTakeover(conversation.id);
    return "output_blocked";
  }
  await reply(deps, conversation, draft);
  return "answered";
}

/**
 * Respuesta fija al paso de la forma de pago (el último mensaje del bot es el resumen sin pago o la repregunta):
 * - elige efectivo / Mercado Pago ("mp", "sí efectivo") → resumen final con la forma de pago y "Respondé SÍ para confirmar";
 * - un SÍ suelto → se pregunta cómo paga (no se asume Mercado Pago);
 * - otra cosa (cambios, preguntas) → null: sigue el camino normal.
 */
export function paymentStep(text: string, outNewestFirst: readonly string[]): string | null {
  const method = paymentChoice(text);
  if (method) {
    // El resumen del servidor más reciente (sin forma de pago): es lo que se vuelve a mostrar completo.
    const summary = outNewestFirst.find((b) => b.startsWith(QUOTE_MARKER) && !/^Pago: /m.test(b));
    return (summary && renderFinalSummary(summary, method)) ?? ORDER_REPLIES.requote;
  }
  return isAffirmation(text, "confirm") ? PAYMENT_QUESTION : null;
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
  const lastSystem = outNewestFirst.find((b) =>
    b.startsWith(QUOTE_MARKER) || b.startsWith(PAYMENT_QUESTION) || b.startsWith(CASH_MARKER) || /^¡Listo! Para confirmar|^Listo, (cancelamos|dejamos)/.test(b));
  const recentQuote = (lastSystem?.startsWith(QUOTE_MARKER) || lastSystem?.startsWith(PAYMENT_QUESTION)) ?? false;
  const recentPayment = lastSystem?.startsWith("¡Listo! Para confirmar") ?? false;
  const wamid = turn.wamids.at(-1);
  const order: OrderTurn | undefined =
    settings.ordersEnabled && deps.orders && wamid
      ? {
          client: deps.orders, repo: deps.repo, conversation, inboundWamid: wamid, inboundText: text,
          hasAudio: turn.audios.length > 0, lastBotMessage: lastBot, recentQuote, recentPayment, appUrl: deps.appUrl, hours: settings.hours,
          estimatedMinutes: settings.estimatedMinutes, state: newOrderState(),
        }
      : undefined;

  // Camino determinista: SÍ literal justo después del resumen (o de la pregunta de cancelar) no pasa por el clasificador.
  const pending = pendingOperation(lastBot);
  // Paso de la forma de pago: elige → resumen final con "Pago: …"; un SÍ suelto → se le vuelve a preguntar.
  if (order && pending === "pay" && !order.hasAudio) {
    const fixed = paymentStep(text, outNewestFirst);
    if (fixed) {
      await reply(deps, conversation, fixed);
      return "answered";
    }
  }
  if (order && (pending === "confirm" || pending === "cancel") && isAffirmation(text, pending) && !order.hasAudio) {
    const direct = pending === "confirm" ? confirmAfterSummary : pending === "cancel" ? cancelAfterPrompt : null;
    if (direct) {
      await direct(order);
      const base = order.state.fixedReply ?? REPLIES.failure;
      await reply(deps, conversation, withFollowUp(base, text, pending, settings), !order.state.handedOff);
      return "answered";
    }
  }
  // "Ya pagué" es siempre una consulta de estado: no se deja al clasificador (lo confundía con un saludo o un pedido).
  const classified = saysPaid(text) ? { intent: "pedido_estado" as Intent, confidence: 1 } : await classify(deps.run, wrapUntrusted(text), lastBot);
  const { intent, confidence } = classified;

  if (intent === "humano") return escalate(deps, conversation, settings, text, REPLIES.handoff);
  // Charla nueva (el bot no respondió en 2 h, o el cliente solo saluda y no se lo saludó hace poco): saludo por nombre con las promos de hoy.
  if (await shouldGreet(deps, conversation.id, text, outNewestFirst)) {
    const promos = promosForToday(await deps.repo.menu().catch(() => []), new Date());
    await reply(deps, conversation, renderGreeting(settings, conversation.displayName, promos));
    if (confidence < MIN_CONFIDENCE || GREETING_ONLY.includes(intent)) return "greeted";
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
  // Cierre o "me avisan cuando salga" después del link de pago: calidez + el estado real (sin inventarlo).
  const closing = order ? await closingAfterPayment(order, intent, text) : null;
  if (closing) {
    await reply(deps, conversation, closing);
    return "answered";
  }
  const early = order ? await afterPaymentHandoff(order, intent, text, outNewestFirst) : null;
  if (early) {
    await deps.repo.setTakeover(conversation.id);
    await reply(deps, conversation, early, false);
    return "answered";
  }
  if (intent === "consulta_menu" && asksFullMenu(text) && inbound.verdict !== "suspicious") await sendMenuPdf(deps, conversation, settings);
  return answer(text, intent, inbound.verdict === "suspicious", conversation, settings, deps, order, lastQuoteAddress(outNewestFirst));
}

/** Sin `lastOutboundAt` en el repo (backend viejo) no hay saludo aparte; si la lectura falla, tampoco (no se repite). */
async function shouldGreet(deps: TurnDeps, conversationId: string, text: string, recentOutbound: readonly string[]): Promise<boolean> {
  if (!deps.repo.lastOutboundAt) return false;
  const last = await deps.repo.lastOutboundAt(conversationId).catch(() => undefined);
  return last !== undefined && shouldGreetNow(last, Date.now(), text, recentOutbound);
}

/** Ruta pública de la carta en PDF (la arma la app con los productos visibles en el portal). */
export const MENU_PDF_PATH = "/api/public/carta.pdf";
export const MENU_PDF_NOTE = "📄 Te mandé la carta en PDF.";

/** Pide la carta completa: se manda el PDF antes de la respuesta del modelo. Si falla, sigue sin PDF. */
async function sendMenuPdf(deps: TurnDeps, conversation: BotConversation, settings: BotSettings): Promise<void> {
  if (!deps.sendDocument) return;
  try {
    const name = settings.businessName.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60) || "Menú";
    const wamid = await deps.sendDocument(conversation.phone, `${deps.appUrl}${MENU_PDF_PATH}`, `Carta ${name}.pdf`, `Carta de ${name}`);
    await deps.repo.saveOutbound(conversation.id, wamid, MENU_PDF_NOTE);
  } catch (error: unknown) {
    deps.log("[whatsapp-bot] no se pudo mandar la carta en PDF", { conversation: conversation.id, error: error instanceof Error ? error.message : "error" });
  }
}

export const CLOSING_PAID = "¡Gracias a vos! 😊 Tu pago ya está acreditado: te avisamos por acá cuando tu pedido salga 🛵";
export const CLOSING_PENDING = "¡Gracias! 😊 Apenas se acredite el pago con Mercado Pago tu pedido sale, y te avisamos por acá cuando esté en camino 🛵";

/** Respuesta fija y cálida a un cierre después del link de pago, según el estado real del pago. */
export async function closingAfterPayment(order: OrderTurn, intent: Intent, text: string): Promise<string | null> {
  if (!order.recentPayment || !isClosingMessage(text) || saysPaid(text)) return null;
  if (!(["saludo", "otro", "pedido_estado", "pedido_confirmar", "consulta_local"] as Intent[]).includes(intent)) return null;
  const st = await order.client.status({ conversationId: order.conversation.id, inboundWamid: order.inboundWamid }).catch(() => null);
  if (!st?.ok || st.data.found !== true) return null;
  return st.data.awaiting_payment === true ? CLOSING_PENDING : CLOSING_PAID;
}

export const PAID_CHANGE_HANDOFF = "Como tu pedido ya está pagado, el cambio lo hace una persona del local 🙏 Ya te paso con alguien para actualizarlo.";
export const PAYMENT_PENDING_HANDOFF = "Mercado Pago a veces tarda unos minutos en avisarnos 🙏 Te paso con una persona del local para que lo revise con vos.";

/**
 * Casos que el modelo no puede resolver solo y antes terminaban en "escribime":
 * - el pedido ya está pagado y el cliente quiere cambiar algo (dirección, productos): lo cambia una persona;
 * - el cliente insiste en que pagó y el bot ya le dijo que el pago estaba pendiente: una persona lo revisa.
 */
export async function afterPaymentHandoff(order: OrderTurn, intent: Intent, text: string, outNewestFirst: readonly string[]): Promise<string | null> {
  const asksChange = /cambi|direcci|me equivoqu|en vez|corregi|agreg|sac[aá]|quit[aá]/i.test(text);
  const wantsChange = asksChange && (intent === "pedido_datos" || intent === "pedido_nuevo" || (intent === "pedido_confirmar" && !saysPaid(text)));
  const insistsPaid = saysPaid(text) && outNewestFirst.slice(0, 3).some((b) => /pago (aun|aún|todav[ií]a) (est[aá] )?pendiente|falta pagar|pendiente de pago/i.test(b));
  if (!order.recentPayment || (!wantsChange && !insistsPaid)) return null;
  const st = await order.client.status({ conversationId: order.conversation.id, inboundWamid: order.inboundWamid }).catch(() => null);
  if (!st?.ok || st.data.found !== true) return null;
  const paid = st.data.awaiting_payment !== true;
  if (wantsChange && paid) return PAID_CHANGE_HANDOFF;
  if (insistsPaid && !paid) return PAYMENT_PENDING_HANDOFF;
  return null;
}

/** Dirección del último resumen (para que el modelo cotice de nuevo sin volver a pedirla). */
export function lastQuoteAddress(outNewestFirst: readonly string[]): string | null {
  const quote = outNewestFirst.find((b) => b.startsWith(QUOTE_MARKER));
  return quote?.match(/^Dirección: (.+)$/m)?.[1]?.trim().slice(0, 200) ?? null;
}
