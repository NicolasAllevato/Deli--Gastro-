/**
 * Fase 5: flujo de pedidos del turno. Plantillas fijas, compuertas y manejo de errores del servidor.
 * Lo que ve el cliente (resumen, link de pago, errores) sale de estas plantillas y de los datos del servidor,
 * nunca de texto libre del modelo. Las compuertas viven acá, no en el prompt.
 */
import { trustedPaymentUrl } from "../guardrails.ts";
import type { BotConversation, BotRepo } from "../repo/types.ts";
import type { OrderFailure, OrderResponse, OrdersClient } from "./client.ts";

export const QUOTE_MARKER = "Resumen de tu pedido";
export const CANCEL_MARKER = "¿Confirmás que querés cancelar tu pedido?";
/** Fallo transitorio de confirm/cancel: la plantilla dice qué operación se reintenta con un SÍ. */
export const RETRY_MARKER = "Tuve un problema al ";
export const RETRY_CONFIRM = `${RETRY_MARKER}confirmar tu pedido.`;
export const RETRY_CANCEL = `${RETRY_MARKER}cancelar tu pedido.`;
const RETRY_SUFFIX = "Respondé SÍ para reintentar.";
export const CANCEL_PROMPT = `${CANCEL_MARKER}\nRespondé SÍ para cancelarlo. Si no, seguimos como estaba. Tranqui, lo resolvemos 🙏`;

/** La respuesta tiene que EMPEZAR con una de estas (después de normalizar). "ok", "listo" o "de acuerdo" solos no alcanzan. */
const AFFIRMATION_STARTS: ReadonlySet<string> = new Set(["si", "sii", "siii", "sip", "dale", "confirmo"]);
/** Relleno que puede acompañar a la afirmación sin cambiar su sentido. Cualquier otra palabra ("no", "pero", "sin", "agregá") la anula. */
const AFFIRMATION_FILLER: ReadonlySet<string> = new Set([
  "si", "sii", "sip", "dale", "confirmo", "porfa", "porfis", "por", "favor", "gracias", "todo", "bien", "perfecto", "genial",
  "joya", "de", "una", "el", "la", "lo", "pedido", "eso", "va", "nomas", "che", "claro", "obvio", "re", "buenisimo",
]);
/** Palabras propias de cada operación: confirmar no acepta "cancelá" y cancelar no acepta "confirmo/pagar". */
const OP_WORDS: Record<"confirm" | "cancel", ReadonlySet<string>> = {
  confirm: new Set(["confirmar", "confirmalo", "adelante", "avanza", "avanzamos", "pagar", "pago", "correcto", "efectivo", "mercado", "mp", "con", "en"]),
  cancel: new Set(["cancela", "cancelalo", "cancelar", "cancelo", "cancelado", "anula", "anulalo", "anular", "seguro"]),
};
const MAX_AFFIRMATION_WORDS = 8;
/** Largo máximo de un SÍ con frase o pregunta al final ("SÍ! 😊 ¿Me mandás el link?"). */
const MAX_AFFIRMATION_CHARS = 200;

/**
 * Palabras que, después del SÍ, indican un cambio o una duda: el mensaje deja de ser una confirmación limpia
 * ("si, agregá una coca", "sí pero sin cebolla", "sí, mejor mañana"). Exactas o por prefijo.
 */
const CHANGE_WORDS: ReadonlySet<string> = new Set([
  "no", "pero", "sin", "otra", "otro", "otras", "otros", "mas", "ademas", "tambien", "mejor", "despues", "todavia", "vez",
  "pedir", "pido", "pedime", "pedimos", "pediria", "espera", "esperate", "espere", "aguanta", "aguarda", "manana",
]);
/** Para cancelar alcanza con que no dude ni pida otra cosa ("SÍ, CANCELÁ YA, NO QUIERO ESPERAR MÁS" sigue siendo SÍ). */
const CANCEL_DOUBTS: ReadonlySet<string> = new Set([
  "pero", "mejor", "todavia", "despues", "espera", "esperate", "espere", "aguanta", "aguarda", "pedir", "pido", "pedime", "otra", "otro",
]);
const CHANGE_PREFIXES: readonly string[] =["agreg", "cambi", "sacal", "saca", "saque", "quit", "sumal", "suma"];
/** Palabras propias de la OTRA operación (confirmar no acepta "cancelá" y al revés). */
const OTHER_OP_PREFIXES: Record<"confirm" | "cancel", readonly string[]> = {
  confirm: ["cancel", "anul"],
  cancel: ["confirm", "pag"],
};

const hasPrefix = (word: string, prefixes: readonly string[]): boolean => prefixes.some((p) => word.startsWith(p));

/** Cancelar con un "no quiero esperar" sigue siendo SÍ; "no lo canceles" o "no sé" no. */
function negatesCancel(words: readonly string[]): boolean {
  return words.some((w, i) => w === "no" && /^(cancel|anul|lo|la|se|quiero$|estoy)/.test(words[i + 1] ?? "") &&
    !(words[i + 1] === "quiero" && /^(esper|perder)/.test(words[i + 2] ?? "")));
}

function restIsClean(rest: readonly string[], op: "confirm" | "cancel" | null): boolean {
  // "SÍ, confirmo que quiero cancelar": confirmar la cancelación sigue siendo cancelar.
  const namesOwnOp = op !== null && rest.some((w) => hasPrefix(w, op === "cancel" ? ["cancel", "anul"] : ["confirm", "pag"]));
  const other = namesOwnOp ? [] : op ? OTHER_OP_PREFIXES[op] : [...OTHER_OP_PREFIXES.confirm, ...OTHER_OP_PREFIXES.cancel];
  for (const w of rest) {
    // Números (cantidades, direcciones) o pedir otra cosa: es un pedido nuevo, no un SÍ al resumen.
    if (/\d/.test(w) || hasPrefix(w, other) || hasPrefix(w, CHANGE_PREFIXES)) return false;
    if (op === "cancel" ? CANCEL_DOUBTS.has(w) : CHANGE_WORDS.has(w)) return false;
  }
  return op !== "cancel" || !negatesCancel(rest);
}

/** Textos de plantilla: el modelo nunca puede mandar un mensaje que los contenga (el cuerpo guardado es la única "marca"). */
export const TEMPLATE_MARKERS: readonly string[] = [QUOTE_MARKER, CANCEL_MARKER, RETRY_MARKER, "Respondé SÍ para", "¿Cómo vas a pagar: efectivo o Mercado Pago?"];

const foldText = (text: string): string => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

/** true si un texto libre del modelo imita una plantilla (resumen, pregunta de cancelar, reintento). */
export function imitatesTemplate(draft: string): boolean {
  const folded = foldText(draft);
  return TEMPLATE_MARKERS.some((m) => folded.includes(foldText(m)));
}

/**
 * Afirmaciones de estado que solo puede dar el sistema (plantilla de pago o `order_status`): confirmado, pagado,
 * en camino, en preparación... Un texto libre del modelo que las diga se reemplaza por `ORDER_STATE_SAFE_REPLY`.
 */
const ORDER_STATE_CLAIMS: readonly RegExp[] = [
  /\b(tu|el|su) pedido\b.{0,40}\b(confirmad[oa]|pagad[oa]|en camino|en proceso|en preparacion|despachad[oa]|saliendo|listo para (salir|enviar))/,
  /\bpedido (esta |quedo |fue |ya esta )?(confirmado|pagado|en camino|en proceso|en preparacion)/,
  /\b(ya (casi )?(te )?llega|ya (sale|salio|esta saliendo))\b/,
  /\b(tu|el|su) pedido\b.{0,30}\b(estara listo|esta recibido|llega en|sale en)/,
  /\bpago (fue |esta |quedo )?(acreditado|recibido|aprobado|confirmado)/,
];

export const PRICE_SAFE_REPLY =
  "Perdón, para no pasarte un precio equivocado: decime qué te gustaría y te armo el resumen con el total exacto.";

export const ORDER_STATE_SAFE_REPLY =
  "Tu pedido se confirma cuando respondés SÍ al resumen (en efectivo) o cuando se acredita el pago con Mercado Pago. Si todavía no lo armamos, decime y lo hacemos.";

/** true si el texto libre del modelo afirma un estado del pedido que solo puede informar el sistema. */
export function claimsOrderState(draft: string): boolean {
  const folded = foldText(draft).replace(/\s+/g, " ");
  return ORDER_STATE_CLAIMS.some((re) => re.test(folded));
}

/** Montos en pesos escritos en un texto ("$3.500", "$ 12,500", "$350"). Ignora centavos. */
export function extractPrices(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\$\s?(\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2}(?!\d))?/g)) {
    out.push(Number(m[1].replace(/[.,]/g, "")));
  }
  return out;
}

const MAX_QTY_MULTIPLE = 20;

/**
 * Precios que el texto libre del modelo puede mencionar: los del menú y las zonas, y hasta 20 unidades de un producto
 * ("2 empanadas $3.600"). Devuelve los montos que no coinciden con ninguno (vacío = OK).
 */
export function unknownPrices(text: string, allowed: readonly number[]): number[] {
  const valid = new Set<number>();
  for (const p of allowed) {
    if (!Number.isFinite(p) || p <= 0) continue;
    for (let k = 1; k <= MAX_QTY_MULTIPLE; k++) valid.add(Math.round(p * k));
  }
  return extractPrices(text).filter((n) => !valid.has(n));
}

/** true si el modelo, con texto libre, le pregunta al cliente si confirma la cancelación. */
export function asksCancelConfirmation(draft: string): boolean {
  const folded = foldText(draft).replace(/\s+/g, " ");
  return /\b(confirm\w*|segur[oa]\w*)\b.{0,40}\bcancel\w*/.test(folded) && /\?/.test(draft);
}

/** Qué operación habilita un SÍ según el último mensaje del bot (null = ninguna). */
export function pendingOperation(lastBot: string | null): "confirm" | "cancel" | "pay" | null {
  if (!lastBot) return null;
  // Resumen sin forma de pago (o la repregunta): primero se elige cómo paga. Solo el resumen final habilita confirmar.
  if (lastBot.startsWith(PAYMENT_QUESTION)) return "pay";
  if (lastBot.startsWith(QUOTE_MARKER)) return chosenPayment(lastBot) ? "confirm" : "pay";
  if (lastBot.startsWith(RETRY_CONFIRM)) return "confirm";
  if (lastBot.startsWith(CANCEL_MARKER) || lastBot.startsWith(RETRY_CANCEL)) return "cancel";
  return null;
}
/** Texto libre del modelo que solo le pide al cliente que responda SÍ al resumen (no cambia nada del pedido). */
const ASKS_FOR_YES = /\bsi\b[^\n]{0,60}\bresumen\b|\bresumen\b[^\n]{0,60}\bsi\b/;

/**
 * Último mensaje del bot que decide qué habilita un SÍ (más nuevo primero). Se saltea UN texto libre del modelo
 * que solo pidió "respondé SÍ al resumen": así el SÍ que sigue confirma ese resumen en vez de empezar de cero.
 */
export function lastDecisiveBotMessage(outNewestFirst: readonly string[]): string | null {
  const [latest, previous] = outNewestFirst;
  if (latest === undefined) return null;
  if (pendingOperation(latest) === null && ASKS_FOR_YES.test(foldText(latest)) && previous !== undefined && pendingOperation(previous) !== null) {
    return previous;
  }
  return latest;
}

/** Minúsculas, sin tildes ni puntuación, espacios colapsados. */
export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Cláusulas del mensaje (separadas por puntuación) y si la primera termina en pregunta. Los emojis se ignoran. */
function clauses(text: string): { parts: string[][]; firstIsQuestion: boolean } {
  const raw = text.split(/([.,;:!?¡¿\n]+)/);
  const parts: string[][] = [];
  let firstIsQuestion = false;
  for (let i = 0; i < raw.length; i += 2) {
    const words = normalizeAnswer(raw[i]).split(" ").filter(Boolean);
    if (words.length === 0) continue;
    if (parts.length === 0) firstIsQuestion = /\?/.test(raw[i + 1] ?? "") || /¿\s*$/.test(raw[i - 1] ?? "");
    parts.push(words);
  }
  return { parts, firstIsQuestion };
}

/**
 * Afirmación: la primera cláusula es un SÍ limpio (SÍ/dale/confirmo + relleno permitido para esa operación) y lo que
 * sigue no pide cambios ni niega ("SÍ! 😊 ¿Me mandás el link?", "Sí, confirmo el pedido! ¿Cuánto tardan?",
 * "SÍ, CANCELA TODO."). Nunca cuentan: un SÍ preguntado ("sí?", "¿dale?"), un SÍ con cambios ("si, agregá una coca",
 * "si pero sin cebolla"), negaciones ("si no", "no sé") ni palabras de la otra operación. `op` null = solo relleno común.
 */
export function isAffirmation(text: string, op: "confirm" | "cancel" | null = null): boolean {
  if (text.length > MAX_AFFIRMATION_CHARS || /^\s*¿/.test(text)) return false;
  const { parts, firstIsQuestion } = clauses(text);
  const [first, ...others] = parts;
  if (!first || firstIsQuestion || first.length > MAX_AFFIRMATION_WORDS || !AFFIRMATION_STARTS.has(first[0])) return false;
  const extra = op ? OP_WORDS[op] : null;
  if (!first.slice(1).every((w) => AFFIRMATION_FILLER.has(w) || (extra?.has(w) ?? false))) return false;
  return restIsClean(others.flat(), op);
}

/** El mensaje trae además una pregunta ("¿cuánto tardan?"): la respuesta fija la contesta al final. */
export function trailingQuestion(text: string): "demora" | "pago" | "otra" | null {
  if (!/[?¿]/.test(text) && !/\b(cuando|cuanto|como|donde)\b/.test(normalizeAnswer(text))) return null;
  const n = normalizeAnswer(text);
  if (/\b(tard|demor|cuando (me )?(lo )?(llega|traen|mandan)|llega)/.test(n)) return "demora";
  if (/\b(link|pag|mercado ?pago|tarjeta)/.test(n)) return "pago";
  return "otra";
}

/** "Ya pagué", "hice el pago": siempre es una consulta de estado del pedido. */
export function saysPaid(text: string): boolean {
  return /\b(ya )?(pague|pagamos|hice el pago|realice el pago|transferi)\b|\bya (lo )?pag|\b(ya |se )acredit/.test(normalizeAnswer(text));
}

/**
 * Mensaje de cierre o de "avisame cuando salga" (gracias, genial, espero que llegue, me avisan...). Sin pedidos ni
 * cambios ni preguntas por el estado puntual: se contesta con calidez desde una plantilla, sin afirmar estados.
 */
export function isClosingMessage(text: string): boolean {
  const n = normalizeAnswer(text);
  if (!n || n.split(" ").length > 30) return false;
  if (/\b(cambi|cancel|agreg|direcci|quiero|pedir|cuanto|tarda|demora|ya sali|donde esta|no lleg)/.test(n)) return false;
  return /^(gracias|genial|perfecto|dale|ok|buenisimo|joya|barbaro|de una|listo|uh|ay|bueno)\b|\b(me avisan|avisen|avisame|avisenme|me avisas|me podes avisar|pueden avisarme|espero (que |q )?llegue|estare atent|estoy atent|que llegue|gracias)\b/.test(n);
}

/** Texto libre que promete hacer algo después ("un momento", "voy a intentar de nuevo"): nunca llega, se reintenta. */
export function promisesLater(draft: string): boolean {
  const f = foldText(draft).replace(/\s+/g, " ");
  return /\bun (momento|segundo|minuto)\b|\b(dame|aguarda(me)?|espera(me)?) un\b|\bvoy a (intentar|volver a|verificar|revisar|cotizar|enviar|mandar|chequear|consultar|confirmar|pasar|derivar|pedir ayuda)|\bya te (lo |la )?(mando|envio|paso el link)/.test(f);
}

export const money = (n: number): string => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
const oneLine = (text: string, max: number): string => text.replace(/\s+/g, " ").trim().slice(0, max);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Plantilla fija del resumen desde los datos del servidor; null si la respuesta no tiene la forma esperada. */
export function renderQuoteSummary(data: Record<string, unknown>): string | null {
  const { lines, subtotal, delivery_fee: fee, total, resolved_address: address } = data;
  if (!Array.isArray(lines) || lines.length === 0 || !isNum(subtotal) || !isNum(fee) || !isNum(total) || typeof address !== "string") return null;
  const rows: string[] = [];
  for (const line of lines as Record<string, unknown>[]) {
    if (typeof line?.name !== "string" || !isNum(line.qty) || !isNum(line.price)) return null;
    rows.push(`• ${line.qty} x ${oneLine(line.name, 80)} — ${money(line.qty * line.price)}`);
  }
  return [
    `${QUOTE_MARKER}:`,
    ...rows,
    `Subtotal: ${money(subtotal)}`,
    `Envío: ${money(fee)}`,
    `Total: ${money(total)}`,
    `Dirección: ${oneLine(address, 200)}`,
    PAYMENT_QUESTION,
  ].join("\n");
}

/**
 * Flujo de pago en tres pasos: resumen (termina con esta pregunta) → el cliente elige efectivo o Mercado Pago →
 * resumen final con la forma de pago ("Pago: …" + FINAL_PROMPT) → SÍ literal → confirmar. Un SÍ suelto al primer
 * resumen no elige nada: se le vuelve a preguntar la forma de pago.
 */
export const PAYMENT_QUESTION = "¿Cómo vas a pagar: efectivo o Mercado Pago?";
export const FINAL_PROMPT = "Respondé SÍ para confirmar.";

export type BotPaymentMethod = "Efectivo" | "Mercado Pago";

/** Palabras permitidas al elegir la forma de pago ("sí, en efectivo porfa", "con mp"). Cualquier otra = no es una elección limpia. */
const PAYMENT_WORDS: ReadonlySet<string> = new Set([
  "si", "sii", "sip", "dale", "ok", "efectivo", "cash", "mercado", "pago", "mp", "mercadopago", "con", "en", "por", "favor", "porfa",
  "gracias", "voy", "a", "pagar", "pago", "pagaria", "prefiero", "el", "la", "de", "una", "link", "mejor",
]);

/** Forma de pago que eligió el cliente; null si el mensaje no es una elección clara (o nombra las dos). */
export function paymentChoice(text: string): BotPaymentMethod | null {
  if (text.length > 80) return null;
  const words = normalizeAnswer(text).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 8 || !words.every((w) => PAYMENT_WORDS.has(w))) return null;
  const cash = words.some((w) => w === "efectivo" || w === "cash");
  const mp = words.some((w) => w === "mp" || w === "mercado" || w === "mercadopago" || w === "link");
  return cash === mp ? null : cash ? "Efectivo" : "Mercado Pago";
}

/** Forma de pago del resumen final (línea "Pago: …") o del aviso de reintento; null si no hay una elegida. */
export function chosenPayment(lastBot: string | null): BotPaymentMethod | null {
  const m = lastBot?.match(/^Pago: (Efectivo|Mercado Pago)$/m) ?? lastBot?.match(/\((Efectivo|Mercado Pago)\)/);
  return (m?.[1] as BotPaymentMethod | undefined) ?? null;
}

/** Resumen final: el mismo resumen del servidor con la forma de pago elegida y el pedido de SÍ. */
export function renderFinalSummary(summary: string, method: BotPaymentMethod): string | null {
  if (!summary.startsWith(QUOTE_MARKER) || chosenPayment(summary)) return null;
  const body = summary.split("\n").filter((l) => l !== PAYMENT_QUESTION && !/^Respondé SÍ/.test(l));
  const how = method === "Efectivo" ? "Pago: Efectivo" : "Pago: Mercado Pago";
  const note = method === "Efectivo" ? "Pagás al recibir." : "Te mando el link de pago.";
  return [...body, how, `${note} ${FINAL_PROMPT}`].join("\n");
}

/** Inicio de la confirmación de un pedido en efectivo (también marca de "ya no hay nada que confirmar"). */
export const CASH_MARKER = "¡Listo! Tu pedido quedó confirmado";

export function renderCashConfirmation(orderCode: string, total: number | null, minutes: number | null): string {
  const amount = total !== null ? ` Total: ${money(total)}, en efectivo al recibir.` : " Pagás en efectivo al recibir.";
  const eta = minutes ? `\nDemora estimada: unos ${minutes} minutos.` : "";
  return `${CASH_MARKER} ✅ Número de pedido: ${oneLine(orderCode, 20)}.${amount}${eta}\nTe avisamos por acá cuando salga 🛵`;
}

export function renderPaymentMessage(paymentUrl: string, total: number | null): string {
  const amount = total !== null ? ` por ${money(total)}` : "";
  return `¡Listo! Para confirmar tu pedido${amount} pagá con Mercado Pago acá: ${paymentUrl}\nTu pedido se confirma cuando se acredite el pago. El link vence en 30 minutos.`;
}

export const ORDER_REPLIES = {
  cancelled: "Listo, cancelamos tu pedido.",
  cancelledUnpaid: "Listo, cancelamos tu pedido 👍. No se cobró nada. Si querés, armamos otro cuando quieras.",
  cancelledPaid: "Listo, ya cancelamos tu pedido 👍 Perdón por el lío. Como ya estaba pagado, te paso con una persona del local que te ayuda con el pago y, si querés, con un pedido nuevo a la dirección correcta.",
  noOrderHandoff: "No encontré un pedido en curso a tu nombre 😕. Te paso con una persona del local para que lo revise con vos.",
  draftDropped: "Listo, dejamos ese pedido sin confirmar: no se cobró nada. Si querés, armamos otro cuando quieras.",
  alreadyCancelled: "Tu pedido ya está cancelado. Si querés, armamos uno nuevo.",
  unavailable: "Tuve un problema, probá de nuevo en un momento.",
  retryLater: "Reintentá en un momento.",
  humanHas: "Ya te está atendiendo una persona del local, en breve te responde.",
  noOrder: "No tenés un pedido en curso.",
  productNotFound: "Ese producto no lo encontré, ¿me decís cuál querés?",
  startOver: "Decime qué querés pedir y la dirección de entrega, y te armo el resumen.",
  requote: "Ese resumen ya no está vigente. Decime de nuevo qué querés pedir y la dirección, y te armo uno nuevo.",
  invalidQuote: "No pude armar el resumen con esos datos. Decime qué productos querés y a qué dirección te lo mandamos.",
  mpOnly: "Por WhatsApp se puede pagar en efectivo (al recibir) o con Mercado Pago.",
} as const;

export const disabledReply = (appUrl: string): string =>
  `Por ahora los pedidos por WhatsApp no están disponibles, hacelo desde la web: ${appUrl}/cliente`;

const EXPLAIN_CODES = new Set(["out_of_zone", "min_order", "total_changed"]);
const REQUOTE_CODES = new Set(["no_draft", "expired", "not_confirmed", "claim_lost"]);
/** Códigos con los que el servidor rechaza una operación con un motivo ya redactado en español. */
const REASON_CODES = new Set(["rejected", "http_409"]);

export interface ErrorContext {
  appUrl: string;
  hours?: { open: string; close: string };
  op?: "quote" | "confirm" | "cancel" | "status";
}

/** Falla que vale la pena reintentar (red, timeout, 5xx, 429, `unavailable`). */
export function isTransient(failure: OrderFailure): boolean {
  return failure.kind === "network" || failure.kind === "timeout" || failure.kind === "bad_response" ||
    failure.status >= 500 || failure.status === 429 || failure.code === "unavailable";
}

/** Mensaje en español para cada rechazo del servidor (o falla de red). Nada de esto pasa la conversación a una persona. */
export function errorReply(failure: OrderFailure, ctx: ErrorContext | string): string {
  const { appUrl, hours, op } = typeof ctx === "string" ? ({ appUrl: ctx } as ErrorContext) : ctx;
  const { code, kind } = failure;
  const why = oneLine(failure.error, 200);
  if (kind === "not_configured" || code === "orders_disabled" || code === "not_configured") return disabledReply(appUrl);
  if (code === "limit_exceeded") return `${why} También podés hacer tu pedido desde la web: ${appUrl}/cliente`;
  if (code === "forbidden") return ORDER_REPLIES.retryLater;
  if (code === "human_takeover") return ORDER_REPLIES.humanHas;
  if (code === "payment_not_supported") return ORDER_REPLIES.mpOnly;
  if (code === "closed") {
    return hours ? `Ahora estamos cerrados. Atendemos de ${hours.open} a ${hours.close}.` : "Ahora estamos cerrados.";
  }
  if (code === "product_unavailable") return ORDER_REPLIES.productNotFound;
  if (EXPLAIN_CODES.has(code)) return `${why} Si querés, armamos el pedido de nuevo.`;
  if (REQUOTE_CODES.has(code)) return ORDER_REPLIES.requote;
  if (REASON_CODES.has(code) && failure.error) {
    return op === "cancel" && /no encontr/i.test(failure.error) ? ORDER_REPLIES.noOrder : why;
  }
  return ORDER_REPLIES.unavailable;
}

/** Estado mutable de UN turno (se crea por turno; nunca se comparte entre conversaciones). */
export interface OrderTurnState {
  /** Hubo `quote_order` en este turno: bloquea `confirm_order`. */
  quoted: boolean;
  /** Respuesta fija que reemplaza el texto del modelo. */
  fixedReply: string | null;
  /** El flujo derivó a una persona en este turno: la respuesta fija sale igual (sin el rechequeo de pausa). */
  handedOff?: boolean;
}

export interface OrderTurn {
  client: OrdersClient;
  repo: BotRepo;
  conversation: BotConversation;
  /** Último wamid entrante del turno: lo fija el turno, no el modelo. */
  inboundWamid: string;
  /** Texto del turno (ya con audios resueltos). */
  inboundText: string;
  hasAudio: boolean;
  /** Último mensaje que el bot le mandó al cliente. */
  lastBotMessage: string | null;
  /** Hay un resumen reciente sin link de pago todavía (pedido armado pero no confirmado). */
  recentQuote?: boolean;
  /** El último mensaje de sistema fue el link de pago: ya no hay nada que confirmar. */
  recentPayment?: boolean;
  appUrl: string;
  hours: { open: string; close: string };
  /** Demora estimada (minutos) para la confirmación de un pedido en efectivo. */
  estimatedMinutes?: number;
  state: OrderTurnState;
}

export const newOrderState = (): OrderTurnState => ({ quoted: false, fixedReply: null });

const common = (t: OrderTurn) => ({ conversationId: t.conversation.id, inboundWamid: t.inboundWamid });
const SENT = { ok: false, note: "El cliente ya recibió la respuesta. No agregues nada más." } as const;

/** Deriva a una persona con un mensaje fijo (el cliente nunca queda sin saber qué pasa). */
async function handOff(t: OrderTurn, message: string): Promise<typeof SENT> {
  await t.repo.setTakeover(t.conversation.id);
  t.state.handedOff = true;
  t.state.fixedReply = message;
  return SENT;
}

const HANDOFF_SUFFIX = "Te paso con una persona del local para ver cómo lo resolvemos.";

async function fail(t: OrderTurn, response: OrderFailure, op: "quote" | "confirm" | "cancel" | "status"): Promise<typeof SENT> {
  // Fallo transitorio de confirm/cancel: se ofrece reintentar con un SÍ (la plantilla dice cuál operación).
  if ((op === "confirm" || op === "cancel") && isTransient(response)) {
    // El reintento de confirmar lleva la forma de pago elegida: el SÍ siguiente confirma con la misma.
    const method = op === "confirm" ? chosenPayment(t.lastBotMessage) : null;
    t.state.fixedReply = op === "confirm" ? `${RETRY_CONFIRM}${method ? ` (${method})` : ""} ${RETRY_SUFFIX}` : `${RETRY_CANCEL} ${RETRY_SUFFIX}`;
    return SENT;
  }
  const message = errorReply(response, { appUrl: t.appUrl, hours: t.hours, op });
  // Cancelar rechazado (ya en preparación, fuera de término, sin pedido): se explica y se deriva enseguida.
  if (op === "cancel" && (REASON_CODES.has(response.code) || response.status === 404)) {
    return handOff(t, message === ORDER_REPLIES.noOrder ? ORDER_REPLIES.noOrderHandoff : `${message} ${HANDOFF_SUFFIX}`);
  }
  t.state.fixedReply = message;
  return SENT;
}

const ownKeys = (value: unknown, allowed: readonly string[]): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) && Object.keys(value).every((k) => allowed.includes(k));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface QuoteArgs {
  items: { product_id: string; qty: number }[];
  address: string;
}

/** Esquema estricto: ni precios, ni totales, ni cliente, ni canje. */
export function parseQuoteArgs(args: unknown): QuoteArgs | null {
  if (!ownKeys(args, ["items", "address"]) || !Array.isArray(args.items) || typeof args.address !== "string") return null;
  const address = args.address.trim();
  if (address.length < 5 || address.length > 200 || args.items.length < 1 || args.items.length > 30) return null;
  const items: QuoteArgs["items"] = [];
  for (const item of args.items as unknown[]) {
    if (!ownKeys(item, ["product_id", "qty"])) return null;
    const { product_id: id, qty } = item;
    if (typeof id !== "string" || !UUID.test(id) || typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 20) return null;
    items.push({ product_id: id, qty });
  }
  return { items, address };
}

export async function runQuote(t: OrderTurn, args: unknown): Promise<unknown> {
  const parsed = parseQuoteArgs(args);
  if (!parsed) return { ok: false, error: "Argumentos inválidos: usá product_id (de get_menu), qty y address. No envíes precios ni totales." };
  t.state.quoted = true;
  const response = await t.client.quote({ ...common(t), ...parsed });
  if (!response.ok) return fail(t, response, "quote");
  const summary = renderQuoteSummary(response.data);
  t.state.fixedReply = summary ?? ORDER_REPLIES.invalidQuote;
  const total = response.data.total;
  return summary
    ? { ok: true, total_text: typeof total === "number" ? money(total) : undefined, note: "El resumen con el total ya se le envía al cliente. No lo repitas ni lo cambies." }
    : SENT;
}

/** Compuertas de `confirm`: (b) sin cotización en este turno, (c) afirmación literal, (e) el cliente vio el resumen. */
function confirmGate(t: OrderTurn): string | null {
  if (t.state.quoted) return "En este mismo turno se cotizó: esperá a que el cliente responda SÍ al resumen.";
  if (t.hasAudio || !isAffirmation(t.inboundText, "confirm")) return "El último mensaje del cliente no es una confirmación literal (SÍ, dale, ok...). Pedile que responda SÍ al resumen.";
  const pending = pendingOperation(t.lastBotMessage);
  if (pending === "pay") {
    // Vio el resumen pero todavía no eligió cómo paga: se pregunta (con plantilla) antes del resumen final.
    t.state.fixedReply = PAYMENT_QUESTION;
    return "El cliente todavía no eligió la forma de pago: se le preguntó.";
  }
  if (pending !== "confirm") {
    // Ya tiene el link de pago: no hay nada que confirmar ni que empezar de nuevo; el modelo responde su mensaje.
    if (t.recentPayment) return "El cliente ya recibió el link de pago: no confirmes nada. Respondé su mensaje con calidez; si pregunta por el pedido o dice que pagó, decile que apenas se acredite sale.";
    // Un SÍ suelto sin resumen a la vista no deja al cliente en un callejón: se le pide empezar de nuevo.
    t.state.fixedReply = ORDER_REPLIES.startOver;
    return "El cliente todavía no vio un resumen para confirmar.";
  }
  return null;
}

export async function runConfirm(t: OrderTurn, args: unknown): Promise<unknown> {
  if (!ownKeys(args, ["payment_method", "notes"])) return { ok: false, error: "Argumentos inválidos." };
  const method = args.payment_method;
  if (method !== "Mercado Pago" && method !== "Efectivo") {
    t.state.fixedReply = ORDER_REPLIES.mpOnly;
    return SENT;
  }
  const gate = confirmGate(t);
  if (gate) return { ok: false, error: gate };
  // La forma de pago es la del resumen final que el cliente vio y aceptó, no la que elija el modelo.
  const chosen = chosenPayment(t.lastBotMessage);
  if (!chosen) return { ok: false, error: "El cliente todavía no eligió la forma de pago: preguntale si paga en efectivo o con Mercado Pago." };
  if (chosen !== method) return { ok: false, error: `El cliente eligió ${chosen}: usá esa forma de pago.` };
  const notes = typeof args.notes === "string" && args.notes.trim() ? { notes: args.notes.trim().slice(0, 300) } : {};
  const response = await t.client.confirm({ ...common(t), payment_method: method, ...notes });
  return handleConfirm(t, response);
}

async function handleConfirm(t: OrderTurn, response: OrderResponse): Promise<unknown> {
  if (!response.ok) return fail(t, response, "confirm");
  // Efectivo: el servidor ya creó el pedido (Recibidos) y devuelve su número.
  if (typeof response.data.order_code === "string") {
    const total = response.data.total;
    t.state.fixedReply = renderCashConfirmation(response.data.order_code, isNum(total) ? total : null, t.estimatedMinutes ?? null);
    return { ok: true, note: "La confirmación del pedido ya se le envía al cliente. No la repitas." };
  }
  const { awaiting_payment: awaiting, payment_url: raw, total } = response.data;
  // El link es el del servidor (normalizado por URL), y solo si es https de Mercado Pago.
  const url = typeof raw === "string" ? trustedPaymentUrl(raw) : null;
  if (awaiting !== true || !url) {
    t.state.fixedReply = ORDER_REPLIES.unavailable;
    return SENT;
  }
  t.state.fixedReply = renderPaymentMessage(url, isNum(total) ? total : null);
  return { ok: true, note: "El link de pago ya se le envía al cliente. No lo repitas." };
}

/** Camino determinista: el cliente respondió SÍ al resumen. */
export const confirmAfterSummary = (t: OrderTurn): Promise<unknown> => runConfirm(t, { payment_method: chosenPayment(t.lastBotMessage) ?? "" });

export async function runCancel(t: OrderTurn, args: unknown): Promise<unknown> {
  if (!ownKeys(args, ["confirmed"])) return { ok: false, error: "Argumentos inválidos." };
  const asked = pendingOperation(t.lastBotMessage) === "cancel";
  const confirmedNow = asked && !t.hasAudio && isAffirmation(t.inboundText, "cancel") && args.confirmed === true;
  if (!confirmedNow) {
    // Antes de preguntar se mira el pedido: sin pedido, cancelado o ya en preparación no tiene sentido preguntar.
    const blocked = await cancelPrecheck(t);
    if (blocked) return blocked;
    // Primero se pregunta con plantilla fija; recién el mensaje siguiente del cliente puede cancelar.
    t.state.fixedReply = CANCEL_PROMPT;
    return { ok: false, note: "Se le preguntó al cliente si confirma la cancelación. Esperá su respuesta." };
  }
  const response = await t.client.cancel({ ...common(t), confirmed: true });
  if (!response.ok) {
    // Solo había un resumen sin confirmar: no había pedido que cancelar, se descarta sin derivar.
    if (t.recentQuote && response.code === "rejected" && /no encontr/i.test(response.error)) {
      t.state.fixedReply = ORDER_REPLIES.draftDropped;
      return SENT;
    }
    return fail(t, response, "cancel");
  }
  // Con nota del servidor (pago pendiente cancelado): no se cobró nada. Sin nota: el pedido ya estaba pagado y la
  // devolución la maneja una persona (el bot nunca promete reembolsos).
  if (typeof response.data.note === "string") {
    t.state.fixedReply = ORDER_REPLIES.cancelledUnpaid;
    return { ok: true, note: "Ya se le avisó al cliente que el pedido quedó cancelado." };
  }
  return handOff(t, ORDER_REPLIES.cancelledPaid);
}

/** Estados de un pedido ya hecho que todavía se pueden cancelar desde el bot (el servidor igual lo valida). */
const CANCELLABLE = /^(recibid|cotizad|esperando|pendiente)/i;

/** Mira el pedido antes de preguntar si cancela. Devuelve la respuesta ya armada cuando no hay nada que preguntar. */
async function cancelPrecheck(t: OrderTurn): Promise<typeof SENT | null> {
  const response = await t.client.status(common(t)).catch(() => null);
  if (!response?.ok) return null; // Sin estado (red, piloto): se pregunta igual y el servidor decide.
  const data = response.data;
  if (data.found === false) {
    // Solo había un resumen sin confirmar: no hay nada que cancelar ni cobrar, se descarta sin derivar.
    if (t.recentQuote) {
      t.state.fixedReply = ORDER_REPLIES.draftDropped;
      return SENT;
    }
    return handOff(t, ORDER_REPLIES.noOrderHandoff);
  }
  if (data.awaiting_payment === true || typeof data.status !== "string") return null;
  if (/^cancel/i.test(data.status)) {
    t.state.fixedReply = ORDER_REPLIES.alreadyCancelled;
    return SENT;
  }
  if (CANCELLABLE.test(data.status)) return null;
  return handOff(t, `Tu pedido ya está "${oneLine(data.status, 40)}" y por acá no lo puedo cancelar. ${HANDOFF_SUFFIX}`);
}

/** Camino determinista: el cliente respondió SÍ a la pregunta de cancelación. */
export const cancelAfterPrompt = (t: OrderTurn): Promise<unknown> => runCancel(t, { confirmed: true });

/** ¿Este número está fuera del piloto (allowlist)? Chequeo barato, sin modelo. */
export async function isOutsidePilot(t: OrderTurn): Promise<boolean> {
  const response = await t.client.status(common(t));
  return !response.ok && response.code === "orders_disabled";
}

/** Señal para que `order_status` caiga al camino legacy (el teléfono no está en la allowlist de pedidos). */
export const LEGACY_STATUS = Symbol("legacy_status");

export async function runStatus(t: OrderTurn): Promise<unknown> {
  const response = await t.client.status(common(t));
  if (!response.ok && response.code === "orders_disabled") return LEGACY_STATUS;
  if (!response.ok) return fail(t, response, "status");
  return Object.fromEntries(Object.entries(response.data).filter(([key]) => key !== "ok"));
}
