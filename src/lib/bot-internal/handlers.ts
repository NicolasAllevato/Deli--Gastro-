import type { createAdminClient } from "@/utils/supabase/admin";
import type { Database, Json } from "@/types/database";
import { ACTIVE_STATUSES } from "@/lib/orders";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { latestPendingIntent } from "@/lib/payments/intents";
import { samePhone, normalizePhone } from "@/lib/whatsapp/phone";
import { parseDraft, withDraft } from "@/lib/agent/draft";
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
  BOT_TIMESTAMP_HEADER,
  MAX_BODY_BYTES,
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
/** Importe máximo por pedido del bot, en pesos. Alto a propósito: corta errores y abusos, no pedidos reales. */
export const DEFAULT_MAX_TOTAL = 150_000;
export const DEFAULT_MAX_ACTIVE_ORDERS = 1;

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
};

function fromActionError(err: ActionError, fallback: number): BotResponse {
  const status = err.code ? STATUS_BY_CODE[err.code] : fallback;
  return reply(status, { ok: false, code: err.code ?? "rejected", error: err.error });
}

// --- Interruptores y topes (se leen de la base en CADA llamada, sin caché) ---

interface BotConfig {
  enabled: boolean;
  allowlist: string[];
  maxUnits: number;
  maxTotal: number;
  maxActive: number;
}

function positive(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = numberConfig(config, key, fallback);
  return value > 0 ? value : fallback;
}

function parseAllowlist(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/) : [];
  return list.map((p) => normalizePhone(String(p))).filter((p) => p.length > 0);
}

async function loadBotConfig(db: Db): Promise<BotConfig> {
  const config = await readConfig(db);
  return {
    enabled: config.bot_orders_enabled === true || config.bot_orders_enabled === "true",
    allowlist: parseAllowlist(config.bot_orders_allowlist),
    maxUnits: positive(config, "bot_max_units", DEFAULT_MAX_UNITS),
    maxTotal: positive(config, "bot_max_total", DEFAULT_MAX_TOTAL),
    maxActive: positive(config, "bot_max_active_orders", DEFAULT_MAX_ACTIVE_ORDERS),
  };
}

function ordersGate(config: BotConfig, conversation: Conversation): BotResponse | null {
  const disabled = refuse(403, "orders_disabled", "Los pedidos por WhatsApp no están habilitados por ahora.");
  if (!config.enabled) return disabled;
  if (config.allowlist.length > 0 && !config.allowlist.some((p) => samePhone(p, conversation.client_phone))) return disabled;
  return null;
}

function limitExceeded(error: string): BotResponse {
  return refuse(422, "limit_exceeded", error);
}

async function activeOrders(db: Db, clientId: string | null, now: Date): Promise<number> {
  if (!clientId) return 0;
  const { data } = await db.from("orders").select("id").eq("client_id", clientId).in("status", [...ACTIVE_STATUSES]);
  const pending = await latestPendingIntent(db, clientId, now);
  return (data?.length ?? 0) + (pending ? 1 : 0);
}

// --- Verificación del mensaje entrante ---

async function loadInbound(db: Db, conversationId: string, wamid: string) {
  const { data } = await db
    .from("wa_messages")
    .select("direction, created_at")
    .eq("conversation_id", conversationId)
    .eq("wamid", wamid)
    .limit(1);
  return data?.[0] ?? null;
}

// --- Idempotencia: el resultado de confirm/cancel se guarda en el estado de la conversación ---

type IdemStore = Partial<Record<"confirm" | "cancel", { key: string; response: BotResponse }>>;

const idemOf = (state: unknown): IdemStore => {
  const raw = typeof state === "object" && state !== null ? (state as { botIdem?: unknown }).botIdem : null;
  return typeof raw === "object" && raw !== null ? (raw as IdemStore) : {};
};

async function saveIdem(db: Db, conversationId: string, op: "confirm" | "cancel", key: string, response: BotResponse) {
  const { data } = await db.from("wa_conversations").select("state").eq("id", conversationId).maybeSingle();
  const state = typeof data?.state === "object" && data.state !== null ? (data.state as Record<string, unknown>) : {};
  const next = { ...state, botIdem: { ...idemOf(state), [op]: { key, response } } };
  await db.from("wa_conversations").update({ state: next as unknown as Json }).eq("id", conversationId);
}

// --- Entrada común ---

type Parsed<K extends BotOperation> = import("zod").infer<(typeof SCHEMAS)[K]>;

interface Context {
  req: BotRequest;
  deps: BotDeps;
  now: Date;
  conversation: Conversation;
  idempotencyKey: string | null;
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
  const config = await loadBotConfig(db);
  const gate = ordersGate(config, ctx.conversation);
  if (gate) return gate;

  const units = body.items.reduce((sum, i) => sum + i.qty, 0);
  if (units > config.maxUnits) {
    return limitExceeded(`El pedido supera las ${config.maxUnits} unidades que puedo tomar por acá. Te paso con una persona.`);
  }
  if ((await activeOrders(db, ctx.conversation.client_id, ctx.now)) >= config.maxActive) {
    return limitExceeded("Ya tenés un pedido en curso. Cuando termine podés hacer otro, o te paso con una persona.");
  }

  const result = await quoteOrder(actionDeps(ctx, body.inboundWamid), { items: body.items, address: body.address });
  if (isActionError(result)) return fromActionError(result, 422);

  if (result.total > config.maxTotal) {
    // quoteOrder ya guardó el borrador: un pedido fuera de tope no puede quedar confirmable.
    await db.from("wa_conversations").update({ state: withDraft(ctx.conversation.state, null) as Json }).eq("id", ctx.conversation.id);
    return limitExceeded("El importe supera el máximo que puedo tomar por acá. Te paso con una persona.");
  }
  return reply(200, { ...result, ok: true });
}

/** El mensaje que confirma tiene que ser posterior al que cotizó (no solo distinto). */
async function confirmIsAfterQuote(ctx: Context, inboundWamid: string): Promise<boolean> {
  const draft = parseDraft(ctx.conversation.state);
  if (!draft) return true; // sin borrador, confirmOrder responde no_draft
  const [quotedBy, current] = await Promise.all([
    loadInbound(ctx.deps.db, ctx.conversation.id, draft.quotedByMessageId),
    loadInbound(ctx.deps.db, ctx.conversation.id, inboundWamid),
  ]);
  if (!quotedBy || !current) return false;
  return new Date(current.created_at).getTime() > new Date(quotedBy.created_at).getTime();
}

async function runConfirm(ctx: Context, body: Parsed<"confirm">): Promise<BotResponse> {
  const { db } = ctx.deps;
  const config = await loadBotConfig(db);
  const gate = ordersGate(config, ctx.conversation);
  if (gate) return gate;

  if (body.payment_method !== "Mercado Pago") {
    return refuse(400, "payment_not_supported", "Por WhatsApp solo se puede pagar con Mercado Pago.");
  }
  if (!(await confirmIsAfterQuote(ctx, body.inboundWamid))) {
    return refuse(409, "not_confirmed", "El cliente todavía no confirmó después de ver la cotización.");
  }
  const draft = parseDraft(ctx.conversation.state);
  if (draft) {
    const units = draft.items.reduce((sum, i) => sum + i.qty, 0);
    if (units > config.maxUnits || draft.subtotal + draft.fee > config.maxTotal) {
      return limitExceeded("El pedido supera lo que puedo tomar por acá. Te paso con una persona.");
    }
  }
  if ((await activeOrders(db, ctx.conversation.client_id, ctx.now)) >= config.maxActive) {
    return limitExceeded("Ya tenés un pedido en curso. Cuando termine podés hacer otro, o te paso con una persona.");
  }

  const result = await confirmOrder(actionDeps(ctx, body.inboundWamid), {
    payment_method: "Mercado Pago",
    notes: body.notes || undefined,
  });
  if (isActionError(result)) return fromActionError(result, 409);
  const response = reply(200, { ...result, ok: true });
  await saveIdem(db, ctx.conversation.id, "confirm", ctx.idempotencyKey ?? body.inboundWamid, response);
  return response;
}

async function runCancel(ctx: Context, body: Parsed<"cancel">): Promise<BotResponse> {
  if (body.confirmed !== true) {
    return refuse(400, "not_confirmed", "Falta la confirmación explícita del cliente para cancelar.");
  }
  const result = await cancelOrder(actionDeps(ctx, body.inboundWamid));
  if (isActionError(result)) return fromActionError(result, 409);
  const response = reply(200, { ...result, ok: true });
  await saveIdem(ctx.deps.db, ctx.conversation.id, "cancel", ctx.idempotencyKey ?? body.inboundWamid, response);
  return response;
}

async function runStatus(ctx: Context, body: Parsed<"status">): Promise<BotResponse> {
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
  const secrets = [deps.secrets.current, deps.secrets.previous].filter(Boolean);
  // Sin secreto el endpoint está apagado (también es el corte de emergencia): falla cerrado.
  if (!deps.secrets.current) return refuse(503, "not_configured", "Servicio no disponible.");

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
    nowMs: now.getTime(),
  });
  if (!verified.ok) return refuse(401, "invalid_signature", "Firma inválida.");

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

  const inbound = await loadInbound(deps.db, conversation.id, body.inboundWamid);
  const fresh = inbound && now.getTime() - new Date(inbound.created_at).getTime() <= INBOUND_MAX_AGE_MS;
  if (!inbound || inbound.direction !== "in" || !fresh) {
    return refuse(403, "forbidden", "El mensaje indicado no corresponde a esta conversación.");
  }

  if (op === "confirm" || op === "cancel") {
    const stored = idemOf(conversation.state)[op];
    if (stored && stored.key === idempotencyKey) {
      return reply(stored.response.status, { ...stored.response.body, replayed: true });
    }
  }

  const ctx: Context = { req, deps, now, conversation, idempotencyKey };
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
    console.error("[bot-internal] error no controlado", op, error);
    response = refuse(500, "internal_error", "No pude procesar la solicitud.");
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
