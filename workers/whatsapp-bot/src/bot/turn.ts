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
import { asksSavedAddress, savedAddressAcceptedHint, buildResponderPrompt, closedTicketReply, isStaleBotMessage, namesAddress, offerSavedAddress, orderReply, profileAddressUnconfirmed, REPLIES } from "./prompts.ts";
import { openNow, settingsFromConfig, type BotSettings } from "./settings.ts";
import { deniesExistingProduct, hoursMismatch, zoneMismatch } from "./draft-checks.ts";
import { isPureGreeting, promosForToday, renderGreeting, shouldGreetNow } from "./greeting.ts";
import { asksFullMenu, completePizzaReply, namesProducts } from "./menu.ts";
import { toolsFor } from "./tools.ts";
import { sessionStart } from "./session.ts";
import { PORTAL_LINE, portalReminderDue } from "./portal.ts";
import type { OrdersClient } from "../orders/client.ts";
import { attachPhotos, complaintUpdateReply, consultaReply, isComplaintReply, looksLikeNewOrder, pingApp, registerComplaint, withoutPhotoMarks, type ComplaintMode, type TurnImage } from "./complaints.ts";
import { esQueja } from "../../../../src/lib/reclamos/categoria.ts";
import { withPrivacy } from "../privacy.ts";
import {
  cancelAfterPrompt, claimsOrderState, confirmAfterSummary, disabledReply, imitatesTemplate, isAffirmation, isOutsidePilot, newOrderState, ORDER_REPLIES,
  asksCancelConfirmation, CANCEL_PROMPT, PRICE_SAFE_REPLY, unknownPrices, promisesLater, trailingQuestion,
  QUOTE_MARKER, CASH_MARKER, PAYMENT_QUESTION, coversAll, paymentChoice, renderFinalSummary, pendingOperation, runCancel, saysPaid, isClosingMessage, type OrderTurn,
  pendingThread, pendingReminder, switchPayment, chosenPayment, THREAD_WINDOW,
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
  /** Guarda en R2 una foto de WhatsApp para un reclamo; devuelve la clave. Sin él las fotos no se guardan. */
  storePhoto?: (ticketId: string, mediaId: string) => Promise<string | null>;
  log: (message: string, detail?: unknown) => void;
}

export type TurnOutcome =
  | "takeover" | "inactive" | "rate_silent" | "rate_notify" | "keyword"
  | "blocked" | "unclear" | "order_redirect" | "answered" | "output_blocked" | "no_conversation" | "empty" | "greeted" | "ticket";

/** Intenciones que en el primer turno reciben SOLO el saludo (con las promos): el pedido arranca en el turno siguiente. */
const GREETING_ONLY: readonly Intent[] = ["saludo", "pedido_nuevo", "otro"];
/** Cantidades escritas con letras: señal de que el primer mensaje ya trae el pedido y no solo "quiero pedir". */
const QUANTITY_WORDS = /\b(?:una?|unos|unas|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|media|medio|docena)\b/i;

/** Mensajes más largos que esto traen algo más que «hola quiero pedir»: no se pierden detrás del saludo. */
const OPENING_MAX_WORDS = 6;

/** Palabras de saludo y de «quiero pedir» a secas: sin ellas, lo que queda es el contenido del mensaje (producto, promo, cantidad). */
const OPENING_FILLER = new Set([
  "hola", "holaa", "holi", "buenas", "buen", "buena", "buenos", "dia", "dias", "tarde", "tardes", "noche", "noches", "que", "tal", "hey",
  "quiero", "quisiera", "queria", "necesito", "me", "gustaria", "voy", "vamos", "a", "hacer", "realizar", "armar", "un", "el", "pedido", "pedir", "ordenar", "encargar",
  "algo", "por", "favor", "porfa", "porfavor", "si", "ok", "dale",
]);

/**
 * El primer mensaje trae una pregunta o un pedido con contenido (no solo un saludo ni «quiero pedir»): se saluda Y se responde.
 * «hola, quiero la promo Baila Ahora» tiene contenido aunque sea corto: lo que sobra al sacar saludo y relleno son 2 palabras o más.
 */
export function openingHasContent(text: string): boolean {
  if (isPureGreeting(text)) return false;
  if (/[?¿]/.test(text) || text.trim().split(/\s+/).length > OPENING_MAX_WORDS) return true;
  const words = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().split(/[^a-z0-9ñ]+/).filter(Boolean);
  return words.filter((w) => !OPENING_FILLER.has(w)).length >= 2;
}

/** Pregunta por su saldo a favor (crédito en pesos por reclamos). No confunde con tarjeta de crédito ni con el saldo de Mercado Pago. */
export function asksCredit(text: string): boolean {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (/tarjeta|mercado ?pago|(^|[^a-z])mp([^a-z]|$)/.test(t)) return false;
  return /(^|[^a-z])saldo([^a-z]|$)|credito (a favor|disponible|que tengo)/.test(t);
}

/** Pide hablar con una persona del local (no es solo una pregunta por su saldo). */
const asksPerson = (text: string): boolean => /\b(persona|humano|encargad[oa]|due[ñn][oa]|gerente|alguien|atienda)\b/i.test(text.normalize("NFD").replace(/[̀-ͯ]/g, ""));

/** El saldo a favor se descuenta solo del próximo pedido; el bot no consulta montos, así que no los inventa. */
export const CREDIT_REPLY = "Si tenés saldo a favor, se descuenta solo: lo vas a ver aplicado en el resumen de tu próximo pedido 😊 ¿Querés que armemos uno?";

/**
 * Un número suelto («2») como respuesta a la pregunta por la dirección o por la cantidad es la CANTIDAD del pedido en curso:
 * sin esta pista el modelo a veces lo tomaba como dirección y contestaba «hubo un error con la dirección».
 */
export function bareNumberHint(text: string, lastBot: string | null): string | null {
  if (!/^\s*\d{1,3}\s*$/.test(text) || !lastBot || !/cu[aá]nt[ao]s?|cantidad|direcci[oó]n/i.test(lastBot) || !/[?¿]/.test(lastBot)) return null;
  return `El cliente respondió solo un número («${text.trim()}») a tu última pregunta: es la CANTIDAD del producto que venían pidiendo (tomalo del historial), no una dirección ni una altura. Anotala sin decir que hubo un error y pedí lo que falte (dirección completa con calle y altura, o si es delivery o retiro).`;
}

/**
 * Pedido de empanadas con cantidad y gusto («una docena y media de carne», «150 empanadas de carne»): se cotiza directo.
 * Va solo en esos turnos (en el prompt general confundía los cambios de cantidad de otros pedidos).
 */
export function empanadaHint(text: string): string | null {
  if (!/empanada|docena|\d+\s+de\s+\p{L}+/iu.test(text)) return null;
  return "EMPANADAS en este pedido: si ya dijo cantidad y gusto («18 de carne», «una docena y media de carne», «150 empanadas de carne») y tenés la dirección, llamá quote_order YA con ese gusto suelto y la cantidad total en unidades (docena y media = 18, media docena = 6): no preguntes si quiere mezclar, no le pidas confirmar el gusto («de carne» = la Empanada de carne común), no le pidas dividir el pedido y no le menciones topes ni límites (NO existe ningún máximo por línea: no digas «máximo por línea», «hasta 100» ni propongas dividir en líneas); si el pedido es muy grande, el sistema se lo explica.";
}

/**
 * Producto nombrado solo por su sabor («la de jamón y morrón»): puede ser una pizza aunque exista una empanada parecida.
 * Va solo en esos turnos para no alargar el prompt general (cada regla de más movía otros guiones).
 */
export function flavorHint(text: string): string | null {
  if (!/\b(?:la|una|las|unas)\s+de\s+\p{L}+/iu.test(text) || /pizza|empanada|docena|bebida|gaseosa|postre|cafe|caf[eé]/i.test(text)) return null;
  return "El cliente nombró un producto solo por su sabor, sin decir la categoría: llamá get_menu y buscalo en TODAS las categorías, puede ser una pizza aunque haya una empanada parecida. Nunca respondas «no tenemos» sin haber revisado también las pizzas y los platos.";
}

/** El borrador vuelca la carta: una lista larga de productos con precio o el cierre típico «¿Te gustaría pedir algo de esto?». */
export function dumpsMenu(draft: string): boolean {
  if (/te gustar[ií]a pedir algo de (esto|esta)/i.test(draft)) return true;
  return draft.split(/\r?\n/).filter((l) => /^\s*(?:[•\-*]|\p{Extended_Pictographic})/u.test(l) && /\$\s?\d/.test(l)).length >= 5;
}

/** El borrador cuenta un tope interno de las herramientas («máximo por línea», «en una sola línea») o propone partir el pedido por eso. */
/** El último mensaje del bot es un resumen de pedido sobre el que el cliente puede pedir cambios. */
export function editsLastSummary(lastBot: string | null | undefined): lastBot is string {
  return typeof lastBot === "string" && /Resumen de tu pedido/i.test(lastBot);
}

/** El cliente pide una cantidad que pasa el tope de unidades del bot (lo decide el local, no el modelo). */
export function asksHugeQuantity(text: string, maxUnits = 100): boolean {
  // Solo números seguidos de un producto («150 empanadas»), no alturas de calle («Juramento 1500», «Santa Fe 1234, Palermo»).
  return [...text.matchAll(/(?:^|[^\p{L}\d])(\d+)\s+(?:de\s+)?\p{L}{3,}/gu)].some((m) => Number(m[1]) > maxUnits && Number(m[1]) < 100000);
}

export function exposesInternalLimit(draft: string): boolean {
  return /(?:m[aá]xim[oa]|l[ií]mite|hasta \d+)[^.\n]{0,30}por l[ií]nea|(?:sola|una|dos|varias|otra|cada) l[ií]neas?\b|(?:dividir|partir|separar|fraccionar) (?:el |tu )?pedido|no (?:puedo|podemos) (?:procesar|tomar|aceptar)[^.\n]{0,20}pedido|cantidad (?:menor|m[aá]s chica)/i.test(draft);
}

const HISTORY_TURNS = 8;
const ORDER_INTENTS: readonly Intent[] = ["pedido_nuevo", "pedido_datos", "pedido_confirmar", "pedido_cancelar"];
const ALLOWED_HOSTS = ["mpago.la", "mercadopago.com.ar", "google.com", "maps.google.com"];

/** Datos del turno que necesita el flujo de reclamos. */
interface TurnExtras {
  images: readonly TurnImage[];
  wamid: string | undefined;
}

/**
 * Queja o pedido de una persona. Una queja SIEMPRE queda registrada (reclamo nuevo o el abierto, actualizado):
 * abierto -> reclamo + derivación a una persona; cerrado -> reclamo sin silenciar al bot. Un pedido de hablar con
 * una persona SIN queja, con el local abierto, solo deriva (como siempre).
 */
/** Entrenamiento gana: los reclamos no se derivan aunque el local esté abierto. */
function complaintMode(settings: BotSettings): ComplaintMode {
  if (settings.trainingMode) return "entrenamiento";
  return openNow(settings) ? "abierto" : "cerrado";
}

async function complaintFlow(
  deps: TurnDeps, conversation: BotConversation, settings: BotSettings, text: string, extras: TurnExtras, openReply: string = REPLIES.handoff,
): Promise<TurnOutcome> {
  const shopOpen = openNow(settings);
  const isComplaint = esQueja(text) || extras.images.length > 0;
  if (!shopOpen || isComplaint) {
    const mode = complaintMode(settings);
    const done = await registerComplaint(deps, conversation, { text, images: extras.images, inboundWamid: extras.wamid, mode, openAt: settings.hours.open });
    if (done) {
      // Solo con el local abierto y fuera de entrenamiento el reclamo pasa a una persona.
      if (mode === "abierto") await deps.repo.setTakeover(conversation.id);
      await reply(deps, conversation, done.text, mode !== "abierto");
      return "ticket";
    }
    if (!shopOpen) {
      await reply(deps, conversation, closedTicketReply(settings));
      return "ticket";
    }
  }
  await deps.repo.setTakeover(conversation.id);
  await reply(deps, conversation, openReply, false);
  return "answered";
}

/**
 * El modelo no tiene la respuesta a una consulta del local (handoff_to_human con motivo «consulta»): queda registrada como ticket
 * (el local la ve en el panel y la contesta), con el local abierto pasa a una persona y cerrado el bot sigue atendiendo.
 * El cliente recibe un aviso fijo (sin «reclamo» ni «perdón por el mal momento»: no es una queja).
 */
async function consultaFlow(deps: TurnDeps, conversation: BotConversation, settings: BotSettings, text: string, extras: TurnExtras): Promise<TurnOutcome> {
  const mode = complaintMode(settings);
  const done = await registerComplaint(deps, conversation, { text, images: extras.images, inboundWamid: extras.wamid, mode, openAt: settings.hours.open, kind: "consulta" });
  if (done) {
    if (mode === "abierto") await deps.repo.setTakeover(conversation.id);
    await reply(deps, conversation, done.text, mode !== "abierto");
    return "ticket";
  }
  // El ticket no se pudo registrar: abierto, igual se pasa a una persona; cerrado, solo se avisa (sin decir que quedó registrado).
  deps.log("[whatsapp-bot] no se pudo registrar la consulta sin respuesta", { conversation: conversation.id });
  if (settings.trainingMode || !openNow(settings)) {
    await reply(deps, conversation, consultaReply(complaintMode(settings), settings.hours.open));
    return "answered";
  }
  await deps.repo.setTakeover(conversation.id);
  await reply(deps, conversation, REPLIES.handoff, false);
  return "answered";
}

/** Motivo de la consulta sin lo que repite el texto del cliente: el ticket guarda su mensaje y el motivo del modelo sin el «consulta:» del principio. */
export function consultaText(turnText: string, motivo: string): string {
  const detail = motivo.replace(/^\s*consulta\s*[:\-–]?\s*/i, "").trim();
  return detail && detail !== turnText.trim() ? `${turnText}\n${detail}`.trim() : turnText.trim();
}

/** El modelo derivó con handoff_to_human: reclamo (como siempre) o consulta sin respuesta. */
function ticketFlow(deps: TurnDeps, conversation: BotConversation, settings: BotSettings, turnText: string, ticket: { motivo: string; kind: "reclamo" | "consulta" }, extras: TurnExtras): Promise<TurnOutcome> {
  return ticket.kind === "consulta"
    ? consultaFlow(deps, conversation, settings, consultaText(turnText, ticket.motivo), extras)
    : complaintFlow(deps, conversation, settings, `${turnText}\n${ticket.motivo}`.trim(), extras);
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
export type DraftIssue = "empty" | "template" | "state" | "price" | "hours" | "zone" | "promise" | "limits" | "menu_dump" | "denied_product" | "blocked";

const RETRY_HINT: Record<DraftIssue, string> = {
  empty: "Tu respuesta anterior quedó vacía. Respondé ahora al cliente en 1 a 3 líneas.",
  template: "No escribas resúmenes de pedido ni pidas que respondan SÍ: para cotizar llamá quote_order y el sistema manda el resumen.",
  state: "No digas que el pedido está confirmado, pagado o en camino: eso lo informa solo el sistema.",
  price: "No escribas montos calculados por vos: usá price_text/total_text tal cual o llamá quote_order.",
  hours: "El horario que dijiste no coincide con el del local: decí solo el que devuelve get_business_info (hours). Si no lo tenés, decí que lo consultás con el local.",
  zone: "No prometas envíos a zonas ni distancias que no figuren en get_business_info (zones, delivery_radius_km). Si no está, decí que lo consultás con el local.",
  promise: "No prometas hacerlo después ni digas «un momento»: hacelo ahora con las herramientas o decí qué dato falta.",
  limits: "Nunca menciones límites ni topes internos (máximo por línea, partir o dividir el pedido): no existen para el cliente. Llamá quote_order YA con la cantidad total que pidió.",
  menu_dump: "El cliente nombró productos concretos para pedir: NO le muestres la carta ni sus categorías. Si algún producto es ambiguo (varias variantes), preguntá solo por ese en UNA línea con las opciones más cercanas y decile que el resto ya lo tenés anotado; si todo está claro, llamá quote_order YA.",
  denied_product: "Dijiste que no tenemos un producto que SÍ está en el menú. Antes de negar nada, llamá get_categoria con lo que el cliente pidió (o get_menu), revisá TODAS las categorías (los gustos de empanadas pueden estar como «Empanada Humita») y respondé con lo que devuelve la herramienta: nombre y price_text.",
  blocked: "Tu respuesta anterior tenía datos que no se pueden mandar. Respondé de nuevo sin datos personales ni links.",
};

/** Reemplazo cálido cuando el modelo insiste en afirmar el estado del pedido (no afirma nada que no sepa el sistema). */
const ORDER_STATE_SOFT_REPLY =
  "¡Genial! 🙌 Apenas se acredite el pago con Mercado Pago tu pedido sale. Si querés saber cómo va, preguntame y te cuento.";

/** Cuando no se puede contestar bien una consulta por su pedido: empatía y una persona lo revisa. */
const STATUS_HANDOFF_REPLY = "Perdón por la espera 🙏 Te paso con una persona del local para que revise tu pedido ya mismo.";

/** Cuando el modelo insiste en afirmar un dato del local que no coincide con la configuración: no se afirma nada y se consulta. */
const CONSULT_LOCAL_REPLY = "Dejame consultarlo con el local y te confirmo.";

/** Pedido con productos nombrados que el modelo no pudo resolver: se pide cuál de cada uno y la dirección (nunca «Decime qué querés pedir»). */
const NAMED_PRODUCTS_FALLBACK =
  "Quiero armarte bien el pedido: ¿me confirmás de cada producto cuál querés (sabor, tamaño o presentación) y la dirección de entrega? Lo que ya me dijiste lo tengo anotado.";

export const SAFE_FALLBACK: Record<DraftIssue, string> = {
  empty: REPLIES.failure,
  template: ORDER_REPLIES.startOver,
  state: ORDER_STATE_SOFT_REPLY,
  price: PRICE_SAFE_REPLY,
  hours: CONSULT_LOCAL_REPLY,
  zone: CONSULT_LOCAL_REPLY,
  promise: "Cualquier cosa que necesites, escribime y te ayudo 😊",
  limits: ORDER_REPLIES.startOver,
  denied_product: CONSULT_LOCAL_REPLY,
  menu_dump: "Quiero armarte bien el pedido: ¿me confirmás de cada producto cuál querés (sabor, tamaño o presentación)? Lo que ya me dijiste lo tengo anotado.",
  blocked: REPLIES.failure,
};

/**
 * Revisa el borrador del modelo antes de enviarlo. Devuelve por qué se descarta (null = se puede enviar):
 * vacío, plantilla de pedido, estado del pedido, monto inventado, horario o zona de envío que no coinciden con los datos del local,
 * promesa de «un momento» o datos que no se pueden mandar.
 */
export async function draftIssue(
  draft: string, intent: Intent, conversation: BotConversation, deps: TurnDeps, settings: BotSettings, order?: OrderTurn, turnText = "",
): Promise<DraftIssue | null> {
  if (!draft.trim()) return "empty";
  // Pidió productos concretos y no la carta: volcar la carta le descarta el pedido (el modelo debe preguntar solo lo ambiguo).
  if ((intent === "pedido_nuevo" || intent === "pedido_datos") && turnText && !asksFullMenu(turnText) && dumpsMenu(draft)) return "menu_dump";
  if (order && imitatesTemplate(draft)) return "template";
  if (intent !== "pedido_estado" && claimsOrderState(draft)) return "state";
  if (draft.includes("$")) {
    const [menu, zones] = await Promise.all([deps.repo.menu(), deps.repo.zones()]);
    // El costo por km del local (config) también es un monto real que el bot puede decir.
    const allowed = [...menu.map((p) => p.price), ...zones.flatMap((z) => [z.fee, z.minOrder]), ...(settings.deliveryCostPerKm ? [settings.deliveryCostPerKm] : [])];
    if (unknownPrices(draft, allowed).length > 0) return "price";
  }
  // «No tenemos X» con X en el menú: el modelo contestó sin consultar las herramientas (o las leyó mal).
  if (/\bno\s+(?:tenemos|tengo|hay|trabajamos|hacemos|vendemos|manejamos|contamos|preparamos|elaboramos)\b/i.test(draft) && deniesExistingProduct(draft, await deps.repo.menu().catch(() => []))) return "denied_product";
  if (hoursMismatch(draft, settings.hours)) return "hours";
  // Solo se leen las zonas si el texto habla de envíos o distancias. Sin zonas ni radio cargados no hay con qué comparar: no marca nada.
  if (/\b(?:enviamos|entregamos|repartimos|mandamos|llegamos|delivery|env[ií]os?|km)\b/i.test(draft)) {
    const zones = await deps.repo.zones();
    if (zoneMismatch(draft, { zones, radiusKm: settings.deliveryRadiusKm })) return "zone";
  }
  if (promisesLater(draft)) return "promise";
  if (exposesInternalLimit(draft)) return "limits";
  const appHost = new URL(deps.appUrl).host;
  const check = withPrivacy(draft, inspectOutbound(draft, { customerPhone: conversation.phone, allowedHosts: [appHost, ...ALLOWED_HOSTS] }));
  return check.verdict === "block" ? "blocked" : null;
}

/** Lee algo que el turno puede hacer sin: ante un error lo deja en el log (solo el mensaje, sin datos del cliente) y devuelve `fallback`. */
async function readOptional<T>(deps: TurnDeps, what: string, read: (() => Promise<T>) | undefined, fallback: T): Promise<T> {
  if (!read) return fallback;
  try {
    return await read();
  } catch (error: unknown) {
    deps.log(`[whatsapp-bot] no se pudo leer ${what}; el turno sigue sin eso`, { error: error instanceof Error ? error.message : "error" });
    return fallback;
  }
}

async function answer(
  turnText: string, intent: Intent, suspicious: boolean, conversation: BotConversation, settings: BotSettings, deps: TurnDeps, order?: OrderTurn,
  knownAddress: string | null = null, reminder: string | null = null, extras: TurnExtras = { images: [], wamid: undefined },
): Promise<TurnOutcome> {
  // Los entrantes del final son este mismo turno (ya guardados por la entrada): van como userText, no como historial.
  const history = await deps.repo.history(conversation.id, HISTORY_TURNS + 5);
  while (history.at(-1)?.direction === "in") history.pop();
  // Lecturas opcionales: si fallan se sigue sin ese bloque, pero queda en el log (antes se tragaba el error en silencio).
  const vocabulary = await readOptional(deps, "el vocabulario", deps.repo.vocabulary?.bind(deps.repo), []);
  const lessons = await readOptional(deps, "las lecciones", deps.repo.lessons?.bind(deps.repo), []);
  // Perfil del cliente habitual: siempre el de ESTE teléfono (etapa 2). Si falla, se sigue sin perfil.
  const profile = await readOptional(deps, "el perfil del cliente", deps.repo.customerProfile ? () => deps.repo.customerProfile!(conversation.phone) : undefined, null);
  const clientTexts = history.filter((h) => h.direction === "in").map((h) => h.body);
  const lastBot = history.filter((h) => h.direction === "out").at(-1)?.body ?? null;
  const guard = (address: string) => profileAddressUnconfirmed(address, profile?.lastAddress, clientTexts, lastBot, turnText);
  // Si el modelo deriva con handoff_to_human en ESTE turno, su mensaje al cliente igual sale (sin el rechequeo
  // de pausa, que si no aborta el envío y el cliente se queda sin respuesta).
  let handedOffNow = false;
  // El modelo llamó handoff_to_human: el reclamo lo registra complaintFlow (con pedido, fotos y aviso), no la herramienta.
  let ticketNow: { motivo: string; kind: "reclamo" | "consulta" } | null = null;
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
            ticketNow = { motivo: input.motivo, kind: input.kind ?? "reclamo" };
            return null;
          },
        }
      : {}),
  };
  const numberHint = bareNumberHint(turnText, lastBot);
  const system = buildResponderPrompt(settings, intent, conversation.displayName ?? profile?.name ?? null, suspicious, vocabulary, lessons, profile) + [numberHint, savedAddressAcceptedHint(turnText, lastBot, profile?.lastAddress), empanadaHint(turnText), flavorHint(turnText)].filter(Boolean).map((h) => `

${h}`).join("");
  const tools = suspicious ? [] : toolsFor(intent, toolRepo, conversation, settings, Date.now, order, guard, deps.log);
  const ask = (extra?: string, forceToolFirst = false) =>
    respond(deps.run, { system: extra ? `${system}\n\nCORRECCIÓN: ${extra}` : system, history: historyMessages(history, settings.ordersEnabled), userText: wrapUntrusted(turnText), tools, forceToolFirst });

  let draft = await ask();
  let issue: DraftIssue | null = null;
  // Un reintento con la corrección: el cliente no recibe el mensaje genérico si el modelo lo puede arreglar.
  for (let attempt = 0; attempt < 2; attempt++) {
    // El modelo derivó: reclamo registrado (si es queja o el local está cerrado) y aviso fijo con el número.
    if (ticketNow !== null) return ticketFlow(deps, conversation, settings, turnText, ticketNow, extras);
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
    // Cliente registrado que YA dio una dirección: no se le ofrece la guardada, se cotiza con la suya (un solo reintento con la herramienta).
    if (attempt === 0 && order && profile?.lastAddress && (intent === "pedido_nuevo" || intent === "pedido_datos") && namesAddress([turnText]) && asksSavedAddress(draft, profile.lastAddress)) {
      draft = await ask("El cliente ya te dio la dirección de entrega en su mensaje: no le ofrezcas ninguna dirección guardada. Llamá quote_order YA con los product_id de get_menu y la dirección que él escribió.", true);
      continue;
    }
    issue = await draftIssue(draft, intent, conversation, deps, settings, order, turnText);
    // Sin problemas, o derivó en este turno (sale su mensaje si es válido, si no el aviso de traspaso).
    if (!issue || handedOffNow) break;
    deps.log("[whatsapp-bot] borrador descartado", { conversation: conversation.id, intent, issue, attempt });
    const hint = issue === "promise" && order && knownAddress
      ? `${RETRY_HINT.promise} Si quiere pedir, llamá quote_order YA con los product_id de get_menu y la dirección "${knownAddress}".${editsLastSummary(lastBot) ? ` Tu último resumen fue:\n${lastBot}\nAplicá el cambio que pide el cliente sobre ese resumen («otra igual» / «una más» = sumar 1 al mismo producto) y cotizá el pedido COMPLETO.` : ""}`
      : RETRY_HINT[issue];
    // Pedido que el modelo contestó con texto (resumen propio o promesa): el reintento lo obliga a usar las herramientas.
    const retryNeedsTool = issue === "denied_product" || (issue === "template" || issue === "promise" || issue === "limits") && (intent === "pedido_nuevo" || intent === "pedido_datos") && tools.some((x) => x.name === "quote_order");
    if (attempt === 0) draft = await ask(hint, retryNeedsTool);
  }

  if (handedOffNow) {
    await reply(deps, conversation, issue ? REPLIES.handoff : draft, false);
    return "answered";
  }
  // Consulta por su pedido que el modelo no pudo contestar sin prometer: una persona lo revisa ya (no un saludo vacío).
  if (ticketNow !== null) return ticketFlow(deps, conversation, settings, turnText, ticketNow, extras);
  if (issue && intent === "pedido_estado") {
    deps.log("[whatsapp-bot] respuesta bloqueada", { conversation: conversation.id, reasons: [issue], handoff: true });
    const done = await complaintFlow(deps, conversation, settings, turnText, extras, STATUS_HANDOFF_REPLY);
    return done === "ticket" ? "ticket" : "output_blocked";
  }
  if (issue) {
    deps.log("[whatsapp-bot] respuesta bloqueada", { conversation: conversation.id, reasons: [issue], empty: issue === "empty" });
    const orderIntent = intent === "pedido_nuevo" || intent === "pedido_datos" || intent === "pedido_confirmar";
    // Pedido más grande que el tope y el modelo lo rechazó solo: lo toma una persona (no se le pide «una cantidad menor»).
    if (orderIntent && (issue === "limits" || issue === "template" || issue === "promise") && asksHugeQuantity([...clientTexts.slice(-3), turnText].join("\n"))) {
      await reply(deps, conversation, REPLIES.handoff, false);
      await deps.repo.setTakeover(conversation.id);
      return "answered";
    }
    // Con productos nombrados nunca sale «Decime qué querés pedir»: se pide cuál de cada uno (lo ya dicho está anotado).
    const named = orderIntent && (issue === "template" || issue === "promise" || issue === "limits") && namesProducts(turnText, await deps.repo.menu().catch(() => []));
    await reply(deps, conversation, named ? NAMED_PRODUCTS_FALLBACK : issue === "promise" && orderIntent ? ORDER_REPLIES.startOver : SAFE_FALLBACK[issue]);
    // Cerrado no hay quien tome la charla: no se silencia al bot.
    if ((issue === "empty" || issue === "blocked") && openNow(settings)) await deps.repo.setTakeover(conversation.id);
    return "output_blocked";
  }
  // Otro tema con un resumen sin confirmar: se contesta y se recuerda el pedido (no se pierde el hilo).
  // Pizzas: la carta se arma con todas las secciones (Pizzas y Pizzas especiales) aunque el modelo copie solo una.
  const carta = await readOptional(deps, "la carta", deps.repo.carta?.bind(deps.repo), []);
  // Cliente registrado: la pregunta por la dirección sale fija con SU última dirección (la arma el código, no el modelo).
  const offered = order && intent !== "pedido_cancelar" && intent !== "pedido_estado" ? offerSavedAddress(draft, profile?.lastAddress, clientTexts, lastBot, turnText) : null;
  const body = completePizzaReply(offered ?? draft, turnText, carta);
  // Consulta de precios, productos o envío (sin pedido en curso): cada tanto se suma la línea del portal; la frecuencia la fija el código.
  const portal = PORTAL_INTENTS.includes(intent) && !reminder && !suspicious && (await portalDue(deps, conversation, settings.portalHours)) ? PORTAL_LINE(deps.appUrl) : null;
  await reply(deps, conversation, [body, reminder, portal].filter(Boolean).join("\n\n"));
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

/** "Sí" sin ningún resumen ni pregunta pendiente. */
export const NOTHING_PENDING_REPLY = "¡Dale! 😊 ¿Qué te gustaría pedir? Decime los productos y la dirección y te armo el resumen.";

/**
 * Pasos fijos del hilo del pedido (antes del clasificador):
 * - resumen final + otra forma de pago ("Mercado", "mejor efectivo", "con mp") → resumen final con la nueva;
 * - resumen final (o pregunta de cancelar) + SÍ, pero con otro tema en el medio → se vuelve a mandar ese mensaje
 *   para que el SÍ siguiente sea sobre lo que el cliente tiene a la vista;
 * - primer resumen → el paso de la forma de pago de siempre (`paymentStep`).
 */
export function threadStep(text: string, thread: { decisive: string | null; sideReplies: number }, pending: ReturnType<typeof pendingOperation>, outNewestFirst: readonly string[] = []): string | null {
  const decisive = thread.decisive;
  if (!decisive) return null;
  if (pending === "confirm" && decisive.startsWith(QUOTE_MARKER) && !coversAll(decisive)) {
    const method = paymentChoice(text);
    if (method && method !== chosenPayment(decisive)) return switchPayment(decisive, method);
  }
  if (thread.sideReplies > 0 && (pending === "confirm" || pending === "cancel") && isAffirmation(text, pending)) return decisive;
  if (pending === "pay") return paymentStep(text, [decisive, ...outNewestFirst]);
  return null;
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
  const images = turn.images ?? [];
  if (conversation.humanTakeover) {
    // Con una persona a cargo no se responde, pero las fotos se suman al reclamo abierto (sin mensaje).
    const open = images.length > 0 ? await deps.repo.openComplaint?.(conversation.id).catch(() => null) : null;
    if (open && (await attachPhotos(deps, open, images)) > 0) await pingApp(deps, conversation.id, open.id, turn.wamids.at(-1));
    return "takeover";
  }

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

  const extras: TurnExtras = { images, wamid: turn.wamids.at(-1) };
  const followUp = await complaintFollowUp(deps, conversation, settings, text, extras);
  if (followUp) return followUp;

  // Contexto por pedido: desde acá el bot solo lee la sesión actual (el panel sigue viendo toda la charla).
  const since = await currentSessionStart(deps, conversation, settings.sessionIdleMs);
  if (since) {
    const full = deps.repo;
    deps = { ...deps, repo: { ...full, history: (id, limit) => full.history(id, limit, since) } };
  }
  const outNewestFirst = (await deps.repo.history(conversation.id, THREAD_WINDOW * 2)).filter((m) => m.direction === "out").map((m) => m.body).reverse();
  // Hilo del pedido: el resumen pendiente aunque después haya habido respuestas de otro tema (carta, horario...).
  const thread = pendingThread(outNewestFirst);
  // Para las compuertas del modelo (confirm_order/cancel_order) el "último mensaje" es el resumen solo si no hubo
  // otro tema en el medio: un SÍ después de charlar de otra cosa nunca confirma a ciegas.
  const lastBot = thread.decisive && thread.sideReplies === 0 ? thread.decisive : outNewestFirst[0] ?? null;
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
  const pending = pendingOperation(thread.decisive);
  if (order && !order.hasAudio) {
    const fixed = threadStep(text, thread, pending, outNewestFirst);
    if (fixed) {
      await reply(deps, conversation, fixed);
      return "answered";
    }
    // "Sí" sin nada pendiente (y sin pregunta abierta del bot): se le pregunta qué quiere, no el "no entendí".
    if (!pending && !recentPayment && isAffirmation(text) && !/\?\s*$/.test(outNewestFirst[0] ?? "")) {
      await reply(deps, conversation, NOTHING_PENDING_REPLY);
      return "answered";
    }
  }
  if (order && thread.sideReplies === 0 && (pending === "confirm" || pending === "cancel") && isAffirmation(text, pending) && !order.hasAudio) {
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

  // «¿Tengo saldo a favor?» el clasificador lo toma por reclamo (humano): se responde con el paso fijo, no se deriva (salvo que pida una persona).
  const creditQuestion = asksCredit(text) && !asksPerson(text);
  if (intent === "humano" && !creditQuestion) return complaintFlow(deps, conversation, settings, text, extras);
  // Charla nueva (el bot no respondió en 2 h, o el cliente solo saluda y no se lo saludó hace poco): saludo por nombre con las promos de hoy.
  // Ráfaga apilada con un pedido concreto ("hola" + "una muzza" + "a Rivadavia 5000"): gana el pedido, sin saludo aparte.
  // Con sustancia: un dígito, varias líneas o una cantidad en palabras ("una napo y dos empanadas"): no se pierde detrás del saludo.
  const orderWithSubstance = (intent === "pedido_nuevo" || intent === "pedido_datos") && confidence >= MIN_CONFIDENCE && (/\d/.test(text) || text.trim().includes("\n") || QUANTITY_WORDS.test(text));
  if (!orderWithSubstance && (await shouldGreet(deps, conversation.id, text, outNewestFirst))) {
    const promos = promosForToday(await deps.repo.menu().catch(() => []), new Date());
    await reply(deps, conversation, renderGreeting(settings, conversation.displayName, promos));
    // Saludo + contenido: si el mensaje trae una pregunta o un pedido, también se responde en este turno.
    const credit = asksCredit(text);
    if (!credit && !openingHasContent(text) && (confidence < MIN_CONFIDENCE || GREETING_ONLY.includes(intent))) return "greeted";
  }
  if (asksCredit(text) && inbound.verdict !== "suspicious") {
    await reply(deps, conversation, CREDIT_REPLY);
    return "answered";
  }
  const reminder = order && thread.decisive ? pendingReminder(thread.decisive) : null;
  if (confidence < MIN_CONFIDENCE) {
    // Dudoso: en vez de la repregunta genérica, el modelo interpreta con el contexto y, si duda, sugiere opciones.
    // Mensaje sospechoso: la respuesta fija de siempre (sin modelo ni herramientas).
    if (inbound.verdict === "suspicious") {
      await reply(deps, conversation, reminder ? `${REPLIES.unclear}\n\n${reminder}` : REPLIES.unclear);
      return "unclear";
    }
    const outcome = await answer(text, "otro", false, conversation, settings, deps, order, lastQuoteAddress(outNewestFirst), reminder);
    return outcome === "answered" ? "unclear" : outcome;
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
  // Carta completa: va solo el PDF y una línea corta (la lista larga en el chat no se lee y se cortaba).
  // Las categorías puntuales ("pizzas", "bebidas") sí se responden en el chat.
  if (intent === "consulta_menu" && asksFullMenu(text) && inbound.verdict !== "suspicious" && deps.sendDocument) {
    const sent = await sendMenuPdf(deps, conversation, settings);
    if (sent) {
      await reply(deps, conversation, reminder ? `${MENU_PDF_REPLY}\n\n${reminder}` : MENU_PDF_REPLY);
      return "answered";
    }
  }
  // "¿Cómo va mi pedido?": respuesta fija con el estado real del sistema (el modelo a veces quedaba bloqueado y derivaba).
  // Solo la pregunta tranquila: una queja por demora ("hace 1 hora que espero!!") sigue el camino de la queja.
  if (order && intent === "pedido_estado" && !saysPaid(text) && !soundsLikeComplaint(text)) {
    const st = await order.client.status({ conversationId: conversation.id, inboundWamid: order.inboundWamid }).catch(() => null);
    const fixed = st?.ok ? renderStatusReply(st.data, settings.estimatedMinutes) : null;
    if (fixed) {
      await reply(deps, conversation, fixed);
      return "answered";
    }
  }
  const sideTopic = !ORDER_INTENTS.includes(intent) && intent !== "pedido_estado";
  return answer(text, intent, inbound.verdict === "suspicious", conversation, settings, deps, order, lastQuoteAddress(outNewestFirst), sideTopic ? reminder : null, extras);
}

/**
 * Seguimiento de un reclamo abierto (sin clasificador): fotos sueltas, o la respuesta del cliente justo después del
 * aviso del reclamo ("sí, ese pedido", "llegó frío"). Se suma al MISMO reclamo: nunca se duplica ni se repite el aviso.
 */
async function complaintFollowUp(deps: TurnDeps, conversation: BotConversation, settings: BotSettings, text: string, extras: TurnExtras): Promise<TurnOutcome | null> {
  if (!deps.repo.openComplaint || !deps.repo.createComplaint) return null;
  const words = withoutPhotoMarks(text);
  const onlyPhotos = extras.images.length > 0 && words.length === 0;
  const recent = await deps.repo.history(conversation.id, 6).catch(() => []);
  const lastBot = recent.filter((m) => m.direction === "out").at(-1)?.body ?? null;
  // Un pedido claro («quiero 2 empanadas a Juramento 1500») no es la respuesta al reclamo: sigue su camino normal.
  const answersComplaint = isComplaintReply(lastBot) && words.length > 0 && words.length <= 300 && !looksLikeNewOrder(words);
  if (!onlyPhotos && !answersComplaint) return null;
  const open = await deps.repo.openComplaint(conversation.id).catch(() => null);
  if (!open) return null;
  const mode = complaintMode(settings);
  const done = await registerComplaint(deps, conversation, { text, images: extras.images, inboundWamid: extras.wamid, mode, openAt: settings.hours.open });
  if (!done) return null;
  await reply(deps, conversation, done.ticket.created ? done.text : complaintUpdateReply(done.ticket.numero, mode, settings.hours.open, onlyPhotos));
  return "ticket";
}

/**
 * Dónde empieza la sesión actual de la charla (null = toda es una sola): después de un pedido cerrado por el bot, de un rato
 * largo sin actividad o de un pedido entregado/cancelado desde la app (este último solo si no hay un resumen pendiente de confirmar).
 * Sin las lecturas opcionales del repo (backend viejo, tests) no hay corte. Un error de lectura tampoco corta: se sigue con todo.
 */
export async function currentSessionStart(deps: TurnDeps, conversation: BotConversation, idleMs: number): Promise<Date | null> {
  if (!deps.repo.recentMessages) return null;
  try {
    const recent = await deps.repo.recentMessages(conversation.id, SESSION_SCAN);
    const byMessages = sessionStart(recent, idleMs);
    const closedAt = deps.repo.lastClosedOrderAt ? await deps.repo.lastClosedOrderAt(conversation.phone) : null;
    if (!closedAt || (byMessages && closedAt <= byMessages)) return byMessages;
    const inSession = recent.filter((m) => !byMessages || m.at >= byMessages);
    const pending = pendingThread(inSession.filter((m) => m.direction === "out").map((m) => m.body).reverse()).decisive !== null;
    if (pending) return byMessages;
    // Los mensajes del cliente posteriores al cierre ya son del pedido nuevo: la sesión arranca en el primero.
    return recent.find((m) => m.direction === "in" && m.at > closedAt)?.at ?? byMessages;
  } catch (error: unknown) {
    deps.log("[whatsapp-bot] no se pudo leer la sesión; el turno sigue con todo el historial", { error: error instanceof Error ? error.message : "error" });
    return null;
  }
}

const PORTAL_INTENTS: readonly Intent[] = ["consulta_menu", "consulta_local"];

/** ¿Toca el recordatorio del portal? Mira los mensajes recientes (con hora si el repo la da); un error de lectura no lo agrega. */
async function portalDue(deps: TurnDeps, conversation: BotConversation, hours: number): Promise<boolean> {
  if (hours <= 0) return false;
  try {
    const recent = deps.repo.recentMessages ? await deps.repo.recentMessages(conversation.id, SESSION_SCAN) : await deps.repo.history(conversation.id, 30);
    return portalReminderDue(recent, Date.now(), hours);
  } catch {
    return false;
  }
}

/** Cuántos mensajes recientes se miran para ubicar el inicio de la sesión. */
const SESSION_SCAN = 80;

/** Sin `lastOutboundAt` en el repo (backend viejo) no hay saludo aparte; si la lectura falla, tampoco (no se repite). */
async function shouldGreet(deps: TurnDeps, conversationId: string, text: string, recentOutbound: readonly string[]): Promise<boolean> {
  if (!deps.repo.lastOutboundAt) return false;
  const last = await deps.repo.lastOutboundAt(conversationId).catch(() => undefined);
  return last !== undefined && shouldGreetNow(last, Date.now(), text, recentOutbound);
}

/** Ruta pública de la carta en PDF (la arma la app con los productos visibles en el portal). */
export const MENU_PDF_PATH = "/api/public/carta.pdf";
export const MENU_PDF_NOTE = "📄 Te mandé la carta en PDF.";
export const MENU_PDF_REPLY = "📄 Ahí te mandé la carta. Si querés ver alguna parte acá, decime cuál: pizzas, empanadas, bebidas, cafetería o postres 😊";

/**
 * URL de la carta con versión por hora: WhatsApp guarda en caché el archivo por URL y seguía mandando una carta
 * vieja. Con `?v=` cambia la URL y Meta baja la vigente (como mucho, una hora de atraso).
 */
export function menuPdfUrl(appUrl: string, now: Date = new Date()): string {
  const v = now.toISOString().slice(0, 13).replace(/\D/g, "");
  return `${appUrl}${MENU_PDF_PATH}?v=${v}`;
}

/** Pide la carta completa: se manda el PDF. Devuelve si salió (si falla, sigue sin PDF). */
async function sendMenuPdf(deps: TurnDeps, conversation: BotConversation, settings: BotSettings): Promise<boolean> {
  if (!deps.sendDocument) return false;
  try {
    const name = settings.businessName.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60) || "Menú";
    const wamid = await deps.sendDocument(conversation.phone, menuPdfUrl(deps.appUrl), `Carta ${name}.pdf`, `Carta de ${name}`);
    await deps.repo.saveOutbound(conversation.id, wamid, MENU_PDF_NOTE);
    return true;
  } catch (error: unknown) {
    deps.log("[whatsapp-bot] no se pudo mandar la carta en PDF", { conversation: conversation.id, error: error instanceof Error ? error.message : "error" });
    return false;
  }
}

/** Señales de enojo o demora: espera larga, "nunca llega", signos repetidos, reclamo. */
export function soundsLikeComplaint(text: string): boolean {
  const t = text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  return /!!|\?\?|hace (mas de |casi )?(una|un|\d+) ?(hora|hs|h\b|min)|no llega|nunca|todavia no|sigo esperando|espero hace|demora|tarda(n|ron)? (mucho|una)|fri[oa]|reclamo|queja|un desastre|me cancelaron|equivoc|falt(a|o|aba)/.test(t);
}

const STATUS_TEXT: Record<string, string> = {
  recibido: "ya lo recibimos 🧾 y entra a la cocina en breve",
  "en preparacion": "está en preparación 🍕",
  "en camino": "ya salió y va en camino 🛵",
  entregado: "figura entregado ✅ ¿Llegó todo bien?",
  cancelado: "figura cancelado",
};

/** Estado del pedido con los datos del servidor; null si la respuesta no tiene la forma esperada. */
export function renderStatusReply(data: Record<string, unknown>, estimatedMinutes: number | null): string | null {
  if (data.found === false) return "No encontré un pedido en curso a tu nombre. ¿Querés que armemos uno? 😊";
  if (data.found !== true) return null;
  if (data.awaiting_payment === true) {
    const url = typeof data.payment_url === "string" && /^https:\/\//.test(data.payment_url) ? `\n${data.payment_url}` : "";
    return `Tu pedido está esperando el pago con Mercado Pago 💳. Apenas se acredite, sale.${url}`;
  }
  if (typeof data.order_code !== "string" || typeof data.status !== "string") return null;
  const key = data.status.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const what = STATUS_TEXT[key] ?? `está en estado «${data.status}»`;
  const lines = [`Tu pedido ${data.order_code} ${what}.`];
  const since = typeof data.minutes_since_order === "number" ? Math.max(0, Math.round(data.minutes_since_order)) : null;
  if ((key === "recibido" || key === "en preparacion") && estimatedMinutes) {
    const left = since !== null ? Math.max(5, estimatedMinutes - since) : estimatedMinutes;
    lines.push(`Demora estimada: unos ${left} minutos más.`);
  }
  if (key === "en camino" && typeof data.courier === "string" && data.courier.trim()) lines.push(`Lo lleva ${data.courier.trim().split(/\s+/)[0]}.`);
  return lines.join("\n");
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
