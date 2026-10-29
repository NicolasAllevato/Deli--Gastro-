/**
 * Fase 5: flujo de pedidos del turno. Plantillas fijas, compuertas y manejo de errores del servidor.
 * Lo que ve el cliente (resumen, link de pago, errores) sale de estas plantillas y de los datos del servidor,
 * nunca de texto libre del modelo. Las compuertas viven acá, no en el prompt.
 */
import { isTrustedPaymentUrl } from "../guardrails.ts";
import type { BotConversation, BotRepo } from "../repo/types.ts";
import type { OrderFailure, OrderResponse, OrdersClient } from "./client.ts";

export const QUOTE_MARKER = "Resumen de tu pedido";
export const CANCEL_MARKER = "¿Confirmás que querés cancelar tu pedido?";
export const CANCEL_PROMPT = `${CANCEL_MARKER}\nRespondé SÍ para cancelarlo. Si no, seguimos como estaba.`;

const AFFIRMATIONS: ReadonlySet<string> = new Set(["si", "confirmo", "dale", "ok", "listo", "de acuerdo"]);
const MAX_AFFIRMATION_CHARS = 24;

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

/** Afirmación literal de una lista corta: una pregunta o un texto largo nunca cuenta. */
export function isAffirmation(text: string): boolean {
  if (text.length > MAX_AFFIRMATION_CHARS || text.includes("?") || text.includes("¿")) return false;
  return AFFIRMATIONS.has(normalizeAnswer(text));
}

const money = (n: number): string => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
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
    "Pago: Mercado Pago",
    "Respondé SÍ para continuar al pago.",
  ].join("\n");
}

export function renderPaymentMessage(paymentUrl: string, total: number | null): string {
  const amount = total !== null ? ` por ${money(total)}` : "";
  return `¡Listo! Para confirmar tu pedido${amount} pagá con Mercado Pago acá: ${paymentUrl}\nTu pedido se confirma cuando se acredite el pago. El link vence en 30 minutos.`;
}

export const ORDER_REPLIES = {
  cancelled: "Listo, cancelamos tu pedido.",
  unavailable: "Tuve un problema, probá de nuevo en un momento.",
  handoff: "Para este pedido te va a atender una persona del local, en breve te responde.",
  requote: "Ese resumen ya no está vigente. Decime de nuevo qué querés pedir y la dirección, y te armo uno nuevo.",
  invalidQuote: "No pude armar el resumen con esos datos. Decime qué productos querés y a qué dirección te lo mandamos.",
  mpOnly: "Por WhatsApp solo se puede pagar con Mercado Pago.",
} as const;

export const disabledReply = (appUrl: string): string =>
  `Por ahora los pedidos por WhatsApp no están disponibles, hacelo desde la web: ${appUrl}/cliente`;

export interface ErrorReply {
  text: string;
  /** Pasar la conversación a una persona. */
  handoff: boolean;
}

const HANDOFF_CODES = new Set(["limit_exceeded", "payment_not_supported", "human_takeover", "forbidden"]);
const EXPLAIN_CODES = new Set(["out_of_zone", "min_order", "closed", "product_unavailable", "total_changed"]);
const REQUOTE_CODES = new Set(["no_draft", "expired", "not_confirmed", "claim_lost"]);

/** Mensaje en español para cada rechazo del servidor (o falla de red). */
export function errorReply(failure: OrderFailure, appUrl: string): ErrorReply {
  const { code, kind } = failure;
  if (kind === "not_configured" || code === "orders_disabled" || code === "not_configured") {
    return { text: disabledReply(appUrl), handoff: false };
  }
  if (HANDOFF_CODES.has(code)) return { text: ORDER_REPLIES.handoff, handoff: true };
  if (EXPLAIN_CODES.has(code)) {
    const why = oneLine(failure.error, 200);
    return { text: `${why} Si querés, armamos el pedido de nuevo.`, handoff: false };
  }
  if (REQUOTE_CODES.has(code)) return { text: ORDER_REPLIES.requote, handoff: false };
  return { text: ORDER_REPLIES.unavailable, handoff: false };
}

/** Estado mutable de UN turno (se crea por turno; nunca se comparte entre conversaciones). */
export interface OrderTurnState {
  /** Hubo `quote_order` en este turno: bloquea `confirm_order`. */
  quoted: boolean;
  /** Respuesta fija que reemplaza el texto del modelo. */
  fixedReply: string | null;
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
  appUrl: string;
  state: OrderTurnState;
}

export const newOrderState = (): OrderTurnState => ({ quoted: false, fixedReply: null });

const common = (t: OrderTurn) => ({ conversationId: t.conversation.id, inboundWamid: t.inboundWamid });
const SENT = { ok: false, note: "El cliente ya recibió la respuesta. No agregues nada más." } as const;

async function fail(t: OrderTurn, response: OrderFailure): Promise<typeof SENT> {
  const reply = errorReply(response, t.appUrl);
  if (reply.handoff) await t.repo.setTakeover(t.conversation.id);
  t.state.fixedReply = reply.text;
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
  if (!response.ok) return fail(t, response);
  const summary = renderQuoteSummary(response.data);
  t.state.fixedReply = summary ?? ORDER_REPLIES.invalidQuote;
  return summary ? { ok: true, note: "El resumen con el total ya se le envía al cliente. No lo repitas ni lo cambies." } : SENT;
}

/** Compuertas de `confirm`: (b) sin cotización en este turno, (c) afirmación literal, (e) el cliente vio el resumen. */
function confirmGate(t: OrderTurn): string | null {
  if (t.state.quoted) return "En este mismo turno se cotizó: esperá a que el cliente responda SÍ al resumen.";
  if (t.hasAudio || !isAffirmation(t.inboundText)) return "El último mensaje del cliente no es una confirmación literal (SÍ, dale, ok...). Pedile que responda SÍ al resumen.";
  if (!t.lastBotMessage?.startsWith(QUOTE_MARKER)) return "El cliente todavía no vio un resumen para confirmar.";
  return null;
}

export async function runConfirm(t: OrderTurn, args: unknown): Promise<unknown> {
  if (!ownKeys(args, ["payment_method", "notes"])) return { ok: false, error: "Argumentos inválidos." };
  if (args.payment_method !== "Mercado Pago") {
    t.state.fixedReply = ORDER_REPLIES.mpOnly;
    return SENT;
  }
  const gate = confirmGate(t);
  if (gate) return { ok: false, error: gate };
  const notes = typeof args.notes === "string" && args.notes.trim() ? { notes: args.notes.trim().slice(0, 300) } : {};
  const response = await t.client.confirm({ ...common(t), payment_method: "Mercado Pago", ...notes });
  return handleConfirm(t, response);
}

async function handleConfirm(t: OrderTurn, response: OrderResponse): Promise<unknown> {
  if (!response.ok) return fail(t, response);
  const { awaiting_payment: awaiting, payment_url: url, total } = response.data;
  // El link es EXACTAMENTE el del servidor, y solo si es https de Mercado Pago.
  if (awaiting !== true || typeof url !== "string" || !isTrustedPaymentUrl(url)) {
    t.state.fixedReply = ORDER_REPLIES.unavailable;
    return SENT;
  }
  t.state.fixedReply = renderPaymentMessage(url, isNum(total) ? total : null);
  return { ok: true, note: "El link de pago ya se le envía al cliente. No lo repitas." };
}

/** Camino determinista: el cliente respondió SÍ al resumen. */
export const confirmAfterSummary = (t: OrderTurn): Promise<unknown> => runConfirm(t, { payment_method: "Mercado Pago" });

export async function runCancel(t: OrderTurn, args: unknown): Promise<unknown> {
  if (!ownKeys(args, ["confirmed"])) return { ok: false, error: "Argumentos inválidos." };
  const asked = t.lastBotMessage?.startsWith(CANCEL_MARKER) === true;
  const confirmedNow = asked && !t.hasAudio && isAffirmation(t.inboundText) && args.confirmed === true;
  if (!confirmedNow) {
    // Primero se pregunta con plantilla fija; recién el mensaje siguiente del cliente puede cancelar.
    t.state.fixedReply = CANCEL_PROMPT;
    return { ok: false, note: "Se le preguntó al cliente si confirma la cancelación. Esperá su respuesta." };
  }
  const response = await t.client.cancel({ ...common(t), confirmed: true });
  if (!response.ok) return fail(t, response);
  t.state.fixedReply = ORDER_REPLIES.cancelled;
  return { ok: true, note: "Ya se le avisó al cliente que el pedido quedó cancelado." };
}

/** Camino determinista: el cliente respondió SÍ a la pregunta de cancelación. */
export const cancelAfterPrompt = (t: OrderTurn): Promise<unknown> => runCancel(t, { confirmed: true });

export async function runStatus(t: OrderTurn): Promise<unknown> {
  const response = await t.client.status(common(t));
  if (!response.ok) return fail(t, response);
  return Object.fromEntries(Object.entries(response.data).filter(([key]) => key !== "ok"));
}
