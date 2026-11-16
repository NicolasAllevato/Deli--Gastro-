import { isBotSilenced } from "@/lib/whatsapp/pause";
import type { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import { ACTIVE_STATUSES } from "@/lib/orders";
import { numberConfig } from "@/lib/orders-server";
import { latestPendingIntent } from "@/lib/payments/intents";
import { samePhone, normalizePhone } from "@/lib/whatsapp/phone";
import { parseDraft, type OrderDraft } from "@/lib/agent/draft";
import { updateConversationState } from "@/lib/agent/conversation-state";
import {
  cancelOrder,
  confirmOrder,
  isActionError,
  orderStatus,
  quoteOrder,
  type ActionError,
  type ActionErrorCode,
  type OrderActionDeps,
} from "@/lib/agent/order-actions";
import { SCHEMAS, type BotOperation } from "./schemas.ts";
import {
  BOT_SIGNATURE_HEADER,
  BOT_NONCE_HEADER,
  BOT_TIMESTAMP_HEADER,
  MAX_BODY_BYTES,
  isUsableSecret,
  verifyBotRequest,
} from "./signature.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];

/** El wamid entrante tiene que ser de los últimos 10 minutos. */
export const INBOUND_MAX_AGE_MS = 10 * 60 * 1000;
const IP_LIMIT = { max: 300, windowMs: 60_000 };
const CONVERSATION_LIMIT = { max: 40, windowMs: 60_000 };

/** Valores por defecto de los topes (se pisan con `global_config`). */
export const DEFAULT_MAX_UNITS = 12;
/** Importe máximo por pedido del bot, en pesos. Conservador para el piloto: se sube desde `global_config.bot_max_total`. */
export const DEFAULT_MAX_TOTAL = 80_000;
export const DEFAULT_MAX_ACTIVE_ORDERS = 1;
/** Un pedido activo más viejo que esto no bloquea al cliente (un "En Camino" olvidado). */
export const DEFAULT_ACTIVE_WINDOW_HOURS = 3;

export interface BotRequest {
  method: string;
  /** Solo el path (sin query), tal como se firmó. */
  path: string;
  headers: { get(name: string): string | null };
  rawBody: string;
  ip: string;
}

export interface BotResponse {
  status: number;
  body: Record<string, unknown>;
}

export interface BotDeps {
  db: Db;
  secrets: { current: string; previous: string };
  now?: () => Date;
  rateLimit: (key: string, max: number, windowMs: number) => Promise<boolean>;
  /** Anti-replay: true si el nonce es nuevo. Sin esta dependencia (tests viejos) no se controla. */
  claimNonce?: (nonce: string, nowMs: number) => Promise<boolean>;
  geocode?: OrderActionDeps["geocode"];
  gateway?: OrderActionDeps["gateway"];
  log?: (event: Record<string, unknown>) => void;
}

const reply = (status: number, body: Record<string, unknown>): BotResponse => ({ status, body });
const refuse = (status: number, code: string, error: string): BotResponse => reply(status, { ok: false, code, error });

const STATUS_BY_CODE: Record<ActionErrorCode, number> = {
  closed: 409,
  no_draft: 409,
  expired: 409,
  not_confirmed: 409,
  claim_lost: 409,
  total_changed: 409,
  out_of_zone: 422,
  min_order: 422,
  product_unavailable: 422,
  limit_exceeded: 422,
  orders_disabled: 403,
  payment_not_supported: 400,
  forbidden: 403,
  human_takeover: 409,
  unavailable: 503,
};

function fromActionError(err: ActionError, fallback: number): BotResponse {
  const status = err.code ? STATUS_BY_CODE[err.code] : fallback;
  return reply(status, { ok: false, code: err.code ?? "rejected", error: err.error });
}

// --- Interruptores y topes (se leen de la base en CADA llamada, sin caché) ---

/**
 * Allowlist de `bot_orders_allowlist`:
 * - ausente, `null`, `[]` o texto vacío explícito = sin restricción (`open`);
 * - `"*"` (texto o dentro de la lista) = todos, a propósito (`all`);
 * - cualquier otro valor definido que no dé ningún teléfono (objeto, número, typo, entradas sin dígitos) = NADIE (fail-closed).
 */
type Allowlist = { mode: "open" } | { mode: "all" } | { mode: "list"; phones: string[] };

interface BotConfig {
  enabled: boolean;
  allowlist: Allowlist;
  maxUnits: number;
  maxTotal: number;
  maxActive: number;
  activeWindowMs: number;
}

function positive(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = numberConfig(config, key, fallback);
  return value > 0 ? value : fallback;
}

export function parseAllowlist(raw: unknown): Allowlist {
  if (raw === undefined || raw === null) return { mode: "open" };
  if (Array.isArray(raw) && raw.length === 0) return { mode: "open" };
  if (typeof raw === "string" && raw.trim() === "") return { mode: "open" };

  const entries: unknown[] = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  if (entries.some((e) => typeof e === "string" && e.trim() === "*")) return { mode: "all" };
  const phones = entries
    .filter((e): e is string | number => typeof e === "string" || typeof e === "number")
    .map((e) => normalizePhone(String(e)))
    .filter((p) => p.length > 0);
  return { mode: "list", phones };
}

/** Una lectura de la base falló: se responde 503 en vez de seguir con datos vacíos (fail-closed). */
class BotUnavailableError extends Error {}

async function loadBotConfig(db: Db): Promise<BotConfig> {
  // Variante que expone el error: `readConfig` lo traga y dejaría la allowlist abierta si la lectura falla.
  const { data, error } = await db.from("global_config").select("key, value");
  if (error) throw new BotUnavailableError("global_config");
  const config = Object.fromEntries((data ?? []).map((r) => [r.key, r.value])) as Record<string, unknown>;
  return {
    enabled: config.bot_orders_enabled === true || config.bot_orders_enabled === "true",
    allowlist: parseAllowlist(config.bot_orders_allowlist),
    maxUnits: positive(config, "bot_max_units", DEFAULT_MAX_UNITS),
    maxTotal: positive(config, "bot_max_total", DEFAULT_MAX_TOTAL),
    maxActive: positive(config, "bot_max_active_orders", DEFAULT_MAX_ACTIVE_ORDERS),
    activeWindowMs: positive(config, "bot_active_window_hours", DEFAULT_ACTIVE_WINDOW_HOURS) * 3_600_000,
  };
}

const disabled = () => refuse(403, "orders_disabled", "Los pedidos por WhatsApp no están habilitados por ahora.");
const takeoverRefusal = () => refuse(409, "human_takeover", "Una persona está atendiendo esta conversación.");
const unavailable = () => refuse(503, "unavailable", "No pude verificar los datos en este momento. Probá de nuevo en un momento.");

/** Solo la allowlist. La usan `status` y `cancel`: el flag `bot_orders_enabled` no los bloquea. */
function allowlistGate(config: BotConfig, conversation: Conversation): BotResponse | null {
  const { allowlist } = config;
  if (allowlist.mode === "open" || allowlist.mode === "all") return null;
  return allowlist.phones.some((p) => samePhone(p, conversation.client_phone)) ? null : disabled();
}

/** `quote` y `confirm`: flag de pedidos encendido y teléfono permitido. */
function ordersGate(config: BotConfig, conversation: Conversation): BotResponse | null {
  if (!config.enabled) return disabled();
  return allowlistGate(config, conversation);
}

const LIMIT_MESSAGE = "El pedido supera lo que puedo tomar por acá. Te paso con una persona.";
const ACTIVE_MESSAGE = "Ya tenés un pedido en curso. Cuando termine podés hacer otro, o te paso con una persona.";

function limitExceeded(error: string): BotResponse {
  return refuse(422, "limit_exceeded", error);
}

/**
 * Pedidos en curso del cliente (activos con menos de `bot_active_window_hours` + un pago pendiente vigente).
 * `null` = no se pudo consultar (el llamador responde 503: fail-closed, no cuenta 0).
 * Sin `client_id` la conversación nunca confirmó un pedido: no hay nada que contar y el cliente se crea al confirmar.
 */
async function activeOrders(db: Db, clientId: string | null, now: Date, config: BotConfig): Promise<number | null> {
  if (!clientId) return 0;
  const { data, error } = await db
    .from("orders")
    .select("id, created_at")
    .eq("client_id", clientId)
    .in("status", [...ACTIVE_STATUSES]);
  if (error) return null;
  const since = now.getTime() - config.activeWindowMs;
  const recent = (data ?? []).filter((o) => new Date(o.created_at).getTime() >= since).length;
  const pending = await latestPendingIntent(db, clientId, now);
  return recent + (pending ? 1 : 0);
}

// --- Verificación del mensaje entrante ---

async function loadInbound(db: Db, conversationId: string, wamid: string) {
  const { data, error } = await db
    .from("wa_messages")
    .select("direction, created_at")
    .eq("conversation_id", conversationId)
    .eq("wamid", wamid)
    .limit(1);
  // Error de base != "no existe": el primero es 503, el segundo lo decide quien llama.
  if (error) throw new BotUnavailableError("wa_messages");
  return data?.[0] ?? null;
}

// --- Idempotencia: el resultado de confirm/cancel se guarda en el estado de la conversación ---

type IdemStore = Partial<Record<"confirm" | "cancel", { key: string; response: BotResponse; at?: string }>>;

/** Una marca más vieja que esto ya no se reproduce. */
export const IDEM_MAX_AGE_MS = 30 * 60 * 1000;

/**
 * El replay NO respeta `bot_orders_enabled` a propósito: es la respuesta ya calculada de un reintento
 * (apagar los pedidos no debe convertir un confirm hecho en un error). El link de pago igual vence solo.
 */
function storedReplay(state: unknown, op: "confirm" | "cancel", key: string | null, now: Date): BotResponse | null {
  const stored = idemOf(state)[op];
  if (!stored || stored.key !== key) return null;
  const at = stored.at ? new Date(stored.at).getTime() : NaN;
  if (!Number.isFinite(at) || now.getTime() - at > IDEM_MAX_AGE_MS) return null;
  return reply(stored.response.status, { ...stored.response.body, replayed: true });
}

const idemOf = (state: unknown): IdemStore => {
  const raw = typeof state === "object" && state !== null ? (state as { botIdem?: unknown }).botIdem : null;
  return typeof raw === "object" && raw !== null ? (raw as IdemStore) : {};
};

/** Guarda la marca de idempotencia. Un fallo acá no puede tirar abajo un confirm/cancel que ya se hizo: se loguea. */
async function saveIdem(ctx: Context, op: "confirm" | "cancel", key: string, response: BotResponse): Promise<void> {
  try {
    const saved = await updateConversationState(ctx.deps.db, ctx.conversation.id, (state) => {
      const base = typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
      return { ...base, botIdem: { ...idemOf(base), [op]: { key, response, at: ctx.now.toISOString() } } };
    });
    if (!saved) console.error("[bot-internal] no se pudo guardar la marca de idempotencia", op, ctx.conversation.id);
  } catch (error: unknown) {
    console.error("[bot-internal] error al guardar la marca de idempotencia", op, ctx.conversation.id, error);
  }
}

// --- Entrada común ---

type Parsed<K extends BotOperation> = import("zod").infer<(typeof SCHEMAS)[K]>;

interface Context {
  req: BotRequest;
  deps: BotDeps;
  now: Date;
  conversation: Conversation;
  idempotencyKey: string | null;
  config: BotConfig;
}

function actionDeps(ctx: Context, inboundWamid: string): OrderActionDeps {
  return {
    db: ctx.deps.db,
    conversationId: ctx.conversation.id,
    messageId: inboundWamid,
    dryRun: false,
    actor: "bot",
    now: () => ctx.now,
    geocode: ctx.deps.geocode,
    gateway: ctx.deps.gateway,
  };
}

async function runQuote(ctx: Context, body: Parsed<"quote">): Promise<BotResponse> {
  const { db } = ctx.deps;
  const { config } = ctx;
  const gate = ordersGate(config, ctx.conversation);
  if (gate) return gate;
  if (isBotSilenced(ctx.conversation)) return takeoverRefusal();

  const units = body.items.reduce((sum, i) => sum + i.qty, 0);
  if (units > config.maxUnits) return limitExceeded(LIMIT_MESSAGE);
  const active = await activeOrders(db, ctx.conversation.client_id, ctx.now, config);
  if (active === null) return unavailable();
  if (active >= config.maxActive) return limitExceeded(ACTIVE_MESSAGE);

  // Los topes se evalúan antes de que quoteOrder guarde el borrador: uno fuera de tope nunca se persiste.
  const checkQuote: OrderActionDeps["checkQuote"] = (q) =>
    q.units > config.maxUnits || q.total > config.maxTotal ? { error: LIMIT_MESSAGE, code: "limit_exceeded" } : null;
  const result = await quoteOrder({ ...actionDeps(ctx, body.inboundWamid), checkQuote }, { items: body.items, address: body.address });
  if (isActionError(result)) return fromActionError(result, 422);
  return reply(200, { ...result, ok: true });
}

/** El mensaje que confirma tiene que ser posterior al que cotizó (no solo distinto). */
async function confirmIsAfterQuote(ctx: Context, draft: OrderDraft, inboundWamid: string): Promise<boolean> {
  const [quotedBy, current] = await Promise.all([
    loadInbound(ctx.deps.db, ctx.conversation.id, draft.quotedByMessageId),
    loadInbound(ctx.deps.db, ctx.conversation.id, inboundWamid),
  ]);
  if (!quotedBy || !current) return false;
  return new Date(current.created_at).getTime() > new Date(quotedBy.created_at).getTime();
}

/** Validador del borrador que `confirmOrder` reclama de verdad (se evalúa tras releerlo y antes del claim). */
function draftValidator(ctx: Context, inboundWamid: string): NonNullable<OrderActionDeps["checkDraft"]> {
  return async (draft) => {
    if (!(await confirmIsAfterQuote(ctx, draft, inboundWamid))) {
      return { error: "El cliente todavía no confirmó después de ver la cotización.", code: "not_confirmed" };
    }
    const units = draft.items.reduce((sum, i) => sum + i.qty, 0);
    if (units > ctx.config.maxUnits || draft.subtotal + draft.fee > ctx.config.maxTotal) {
      return { error: LIMIT_MESSAGE, code: "limit_exceeded" };
    }
    return null;
  };
}

/** Si el cliente ya tiene un pago abierto (la respuesta del confirm anterior se perdió), se le devuelve el mismo link. */
async function pendingPaymentLink(ctx: Context): Promise<BotResponse | null> {
  const clientId = ctx.conversation.client_id;
  if (!clientId || parseDraft(ctx.conversation.state)) return null;
  const pending = await latestPendingIntent(ctx.deps.db, clientId, ctx.now);
  if (!pending?.checkout_url || pending.channel !== "whatsapp") return null;
  return reply(200, { ok: true, awaiting_payment: true, payment_url: pending.checkout_url, total: Number(pending.total), replayed: true });
}

async function runConfirm(ctx: Context, body: Parsed<"confirm">): Promise<BotResponse> {
  const { db } = ctx.deps;
  const { config } = ctx;
  const gate = ordersGate(config, ctx.conversation);
  if (gate) return gate;
  if (isBotSilenced(ctx.conversation)) return takeoverRefusal();

  if (body.payment_method !== "Mercado Pago") {
    return refuse(400, "payment_not_supported", "Por WhatsApp solo se puede pagar con Mercado Pago.");
  }
  const lost = await pendingPaymentLink(ctx);
  if (lost) return lost;

  const active = await activeOrders(db, ctx.conversation.client_id, ctx.now, config);
  if (active === null) return unavailable();
  if (active >= config.maxActive) return limitExceeded(ACTIVE_MESSAGE);

  const result = await confirmOrder(
    { ...actionDeps(ctx, body.inboundWamid), checkDraft: draftValidator(ctx, body.inboundWamid) },
    { payment_method: "Mercado Pago", notes: body.notes || undefined },
  );
  if (isActionError(result)) return fromActionError(result, 409);
  const response = reply(200, { ...result, ok: true });
  await saveIdem(ctx, "confirm", ctx.idempotencyKey ?? body.inboundWamid, response);
  return response;
}

async function runCancel(ctx: Context, body: Parsed<"cancel">): Promise<BotResponse> {
  const gate = allowlistGate(ctx.config, ctx.conversation);
  if (gate) return gate;
  if (body.confirmed !== true) {
    return refuse(400, "not_confirmed", "Falta la confirmación explícita del cliente para cancelar.");
  }
  const result = await cancelOrder(actionDeps(ctx, body.inboundWamid));
  if (isActionError(result)) return fromActionError(result, 409);
  const response = reply(200, { ...result, ok: true });
  await saveIdem(ctx, "cancel", ctx.idempotencyKey ?? body.inboundWamid, response);
  return response;
}

async function runStatus(ctx: Context, body: Parsed<"status">): Promise<BotResponse> {
  const gate = allowlistGate(ctx.config, ctx.conversation);
  if (gate) return gate;
  const result = await orderStatus(actionDeps(ctx, body.inboundWamid));
  if (isActionError(result)) return fromActionError(result, 409);
  return reply(200, { ...result, ok: true });
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

/** Orquesta firma, validación, verificación del wamid, interruptores e idempotencia. */
async function processBot(op: BotOperation, req: BotRequest, deps: BotDeps): Promise<BotResponse> {
  const now = (deps.now ?? (() => new Date()))();
  const secrets = [deps.secrets.current, deps.secrets.previous].filter(isUsableSecret);
  // Sin secreto (o uno de menos de 32 caracteres) el endpoint está apagado: falla cerrado, es el corte de emergencia.
  if (!isUsableSecret(deps.secrets.current)) return refuse(503, "not_configured", "Servicio no disponible.");

  if (!(await deps.rateLimit(`bot-ip:${req.ip}`, IP_LIMIT.max, IP_LIMIT.windowMs))) {
    return refuse(429, "rate_limited", "Demasiadas solicitudes.");
  }
  if (Buffer.byteLength(req.rawBody, "utf8") > MAX_BODY_BYTES) return refuse(413, "too_large", "Cuerpo demasiado grande.");

  const verified = verifyBotRequest({
    secrets,
    method: req.method,
    path: req.path,
    body: req.rawBody,
    timestamp: req.headers.get(BOT_TIMESTAMP_HEADER),
    signature: req.headers.get(BOT_SIGNATURE_HEADER),
    nonce: req.headers.get(BOT_NONCE_HEADER),
    nowMs: now.getTime(),
  });
  if (!verified.ok) return refuse(401, "invalid_signature", "Firma inválida.");
  // Una llamada firmada se acepta una sola vez (el formato sin nonce queda solo por compatibilidad durante el deploy).
  const nonce = req.headers.get(BOT_NONCE_HEADER);
  if (nonce && deps.claimNonce && !(await deps.claimNonce(nonce, now.getTime()))) {
    return refuse(409, "replay", "Llamada repetida.");
  }

  const parsed = SCHEMAS[op].safeParse(parseJson(req.rawBody));
  if (!parsed.success) return refuse(400, "invalid_body", parsed.error.issues[0]?.message ?? "Cuerpo inválido.");
  const body = parsed.data as Parsed<"quote"> & Parsed<"confirm"> & Parsed<"cancel"> & Parsed<"status">;

  if (!(await deps.rateLimit(`bot-conv:${body.conversationId}`, CONVERSATION_LIMIT.max, CONVERSATION_LIMIT.windowMs))) {
    return refuse(429, "rate_limited", "Demasiadas solicitudes para esta conversación.");
  }

  const idempotencyKey = req.headers.get("idempotency-key")?.trim() || null;
  if ((op === "confirm" || op === "cancel") && idempotencyKey !== body.inboundWamid) {
    return refuse(400, "idempotency_required", "Falta el header Idempotency-Key (igual al inboundWamid).");
  }

  const { data: conversation } = await deps.db.from("wa_conversations").select("*").eq("id", body.conversationId).maybeSingle();
  if (!conversation) return refuse(404, "not_found", "Conversación no encontrada.");

  // Pertenencia y dirección del wamid: vale siempre, también para un reintento demorado.
  const inbound = await loadInbound(deps.db, conversation.id, body.inboundWamid);
  if (!inbound || inbound.direction !== "in") {
    return refuse(403, "forbidden", "El mensaje indicado no corresponde a esta conversación.");
  }

  // Replay ANTES de la frescura: un reintento demorado de la cola recibe la respuesta ya calculada.
  if (op === "confirm" || op === "cancel") {
    const replay = storedReplay(conversation.state, op, idempotencyKey, now);
    if (replay) return replay;
  }

  if (now.getTime() - new Date(inbound.created_at).getTime() > INBOUND_MAX_AGE_MS) {
    return refuse(403, "forbidden", "El mensaje indicado no corresponde a esta conversación.");
  }

  const config = await loadBotConfig(deps.db);
  const ctx: Context = { req, deps, now, conversation, idempotencyKey, config };
  switch (op) {
    case "quote":
      return runQuote(ctx, body);
    case "confirm":
      return runConfirm(ctx, body);
    case "cancel":
      return runCancel(ctx, body);
    case "status":
      return runStatus(ctx, body);
  }
}

/** Atiende una operación del bot y deja un registro sin datos personales (solo ids y resultado). */
export async function handleBot(op: BotOperation, req: BotRequest, deps: BotDeps): Promise<BotResponse> {
  let response: BotResponse;
  try {
    response = await processBot(op, req, deps);
  } catch (error: unknown) {
    if (error instanceof BotUnavailableError) {
      console.error("[bot-internal] lectura fallida", op, error.message);
      response = unavailable();
    } else {
      console.error("[bot-internal] error no controlado", op, error);
      response = refuse(500, "internal_error", "No pude procesar la solicitud.");
    }
  }
  const log = deps.log ?? ((event) => console.info("[bot-internal]", JSON.stringify(event)));
  const parsed = parseJson(req.rawBody) as { conversationId?: unknown; inboundWamid?: unknown } | undefined;
  log({
    actor: "bot",
    op,
    status: response.status,
    code: response.body.code ?? null,
    conversationId: typeof parsed?.conversationId === "string" ? parsed.conversationId : null,
    inboundWamid: typeof parsed?.inboundWamid === "string" ? parsed.inboundWamid : null,
  });
  return response;
}

export const handleQuote = (req: BotRequest, deps: BotDeps) => handleBot("quote", req, deps);
export const handleConfirm = (req: BotRequest, deps: BotDeps) => handleBot("confirm", req, deps);
export const handleCancel = (req: BotRequest, deps: BotDeps) => handleBot("cancel", req, deps);
export const handleStatus = (req: BotRequest, deps: BotDeps) => handleBot("status", req, deps);
