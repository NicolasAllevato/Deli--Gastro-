import type { createAdminClient } from "@/utils/supabase/admin";
import type { Database, Json } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import { minutesSince, type PAYMENT_METHODS } from "@/lib/orders";
import { cancelOrderForClient, createDeliveryOrder, priceOrder } from "@/lib/orders-create";
import { getGateway, type PaymentGateway } from "@/lib/payments/gateway";
import { cancelPendingIntent, latestPendingIntent, startOnlinePayment } from "@/lib/payments/intents";
import { SAMPLE_ADDRESSES } from "@/lib/restaurant";
import { ensureClientForConversation } from "@/lib/whatsapp/clients";
import { loadDeliverySettings } from "@/lib/zones-server";
import { mayConfirm, parseDraft, withDraft, type OrderDraft } from "./draft.ts";
import { isOpenNow } from "./hours.ts";
import { loadAgentSettings } from "./settings.ts";

/**
 * Acciones de pedido del agente (cotizar, confirmar, cancelar, estado, datos del cliente).
 * Son funciones de dominio sin dependencia del SDK de herramientas ni de zod: las valida y
 * adapta quien las llama (hoy `tools.ts`; mañana el Worker vía endpoints internos).
 */

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];
export type OrderPaymentMethod = (typeof PAYMENT_METHODS)[number];

const HISTORY_ORDERS = 3;

/** Lo que las acciones necesitan del entorno. Los campos opcionales existen para poder inyectarlos en tests. */
export interface OrderActionDeps {
  db: Db;
  /** Conversación ya cargada (agente en Next). Alternativa a `conversationId`. */
  conversation?: Conversation;
  /** Solo el id: la conversación se carga de la base en cada acción (endpoints internos del bot). */
  conversationId?: string;
  /** Quién actúa en la bitácora de pedidos. Por defecto `agente`; los endpoints del bot pasan `bot`. */
  actor?: string;
  /** Mensaje entrante que se está respondiendo (para la guardia de confirmación). */
  messageId: string;
  /** Prueba del panel: lee todo pero no crea ni cancela pedidos ni deriva la conversación. */
  dryRun: boolean;
  /** Reloj inyectable. Por defecto, la hora actual. */
  now?: () => Date;
  /** Búsqueda de direcciones. Por defecto: ejemplos en demo, geocodificador real si no. */
  geocode?: (address: string, local: Parameters<typeof geocodeAddress>[1]) => Promise<GeocodeResult[]>;
  /** Pasarela de cobro. Por defecto: `getGateway()`. */
  gateway?: () => PaymentGateway | null;
}

/** Motivo estable de un rechazo, para que quien llama (el Worker) decida sin leer el texto. */
export type ActionErrorCode =
  | "closed"
  | "no_draft"
  | "expired"
  | "not_confirmed"
  | "claim_lost"
  | "out_of_zone"
  | "min_order"
  | "product_unavailable"
  | "total_changed"
  | "orders_disabled"
  | "payment_not_supported"
  | "limit_exceeded"
  | "forbidden";

export interface ActionError {
  error: string;
  code?: ActionErrorCode;
}

export interface QuoteInput {
  items: Array<{ product_id: string; qty: number }>;
  address: string;
}

export interface QuoteResult {
  lines: Array<{ name: string; qty: number; price: number }>;
  subtotal: number;
  delivery_fee: number;
  total: number;
  zone: unknown;
  resolved_address: string;
  note: string;
}

export interface ConfirmInput {
  payment_method: OrderPaymentMethod;
  notes?: string;
}

export type ConfirmResult =
  | ActionError
  | { ok: true; dry_run: true; note: string }
  | { ok: true; awaiting_payment: true; payment_url: string; total: number; note: string }
  | { ok: true; order_code: string; total: number; payment_method: OrderPaymentMethod };

export type CancelResult = ActionError | { ok: true; dry_run?: true; note?: string };

export type OrderStatusResult =
  | { found: false }
  | { found: true; awaiting_payment: true; total: number; payment_url: string | null; expires_at: string }
  | {
      found: true;
      order_code: string;
      status: string;
      items: string | null;
      total: number;
      courier: string | null;
      minutes_since_order: number;
    };

export type CustomerResult =
  | { known: false; name: string | null }
  | { known: true; name: string | null; saved_address: string | null; recent_orders: unknown[] };

/** En el demo no hay internet: se busca entre las direcciones de ejemplo. */
function demoGeocode(query: string): GeocodeResult[] {
  const words = query.toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 4);
  return SAMPLE_ADDRESSES.filter((a) => {
    const haystack = `${a.label} ${a.address}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) || words.some((w) => haystack.includes(w));
  }).map((a) => ({ label: a.address, lat: a.lat, lng: a.lng }));
}

const clock = (deps: OrderActionDeps): Date => (deps.now ?? (() => new Date()))();
const actorOf = (deps: OrderActionDeps): string => deps.actor ?? "agente";

export const isActionError = (value: unknown): value is ActionError =>
  typeof value === "object" && value !== null && typeof (value as { error?: unknown }).error === "string";

const FAILURE_CODES: readonly ActionErrorCode[] = ["closed", "out_of_zone", "min_order", "product_unavailable", "total_changed"];
/** Pasa el `code` de una falla de negocio solo si es uno de los conocidos. */
function failure(out: { message: string; code?: string }): ActionError {
  const code = FAILURE_CODES.find((c) => c === out.code);
  return code ? { error: out.message, code } : { error: out.message };
}

/** El servidor, no el modelo, decide si se pueden tomar pedidos: cerrado o en pausa = no. */
export async function closedReason(db: Db, now: Date = new Date()): Promise<string | null> {
  const settings = await loadAgentSettings(db);
  if (settings.paused) return "El local pausó los pedidos por ahora.";
  if (!isOpenNow(settings.hours.open, settings.hours.close, now)) {
    return `El local está cerrado. Abre de ${settings.hours.open} a ${settings.hours.close}.`;
  }
  return null;
}

/**
 * Relee la conversación de la base. Si no se puede leer (error o sin fila) devuelve un error:
 * nunca cae al valor que se tenía en memoria, que puede estar viejo (borrador ya reclamado).
 */
export async function reloadConversation(deps: OrderActionDeps): Promise<Conversation | ActionError> {
  const id = deps.conversationId ?? deps.conversation?.id;
  if (!id) return { error: "Falta la conversación." };
  const { data, error } = await deps.db.from("wa_conversations").select("*").eq("id", id).maybeSingle();
  if (error || !data) return { error: "No pude leer la conversación. Probá de nuevo en un momento." };
  return data;
}

async function latestOrder(deps: OrderActionDeps, clientId: string | null) {
  if (!clientId) return null;
  const { data } = await deps.db
    .from("orders")
    .select("id, status, items_desc, total, courier_name, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
}

export async function customerInfo(deps: OrderActionDeps): Promise<CustomerResult | ActionError> {
  const { db } = deps;
  const conversation = await reloadConversation(deps);
  if (isActionError(conversation)) return conversation;
  if (!conversation.client_id) return { known: false, name: conversation.contact_name };
  const [{ data: client }, { data: orders }] = await Promise.all([
    db.from("clients").select("name, address").eq("id", conversation.client_id).maybeSingle(),
    db
      .from("orders")
      .select("items_desc, total, status, created_at")
      .eq("client_id", conversation.client_id)
      .order("created_at", { ascending: false })
      .limit(HISTORY_ORDERS),
  ]);
  return { known: true, name: client?.name ?? conversation.contact_name, saved_address: client?.address ?? null, recent_orders: orders ?? [] };
}

/**
 * Cotiza y guarda el borrador en la conversación. OJO: escribe el borrador AUN con `dryRun`
 * (la prueba del panel necesita ese borrador para probar la confirmación); `dryRun` solo
 * evita crear/cancelar pedidos en `confirmOrder`/`cancelOrder`.
 */
export async function quoteOrder(deps: OrderActionDeps, input: QuoteInput): Promise<QuoteResult | ActionError> {
  const { db } = deps;
  const closed = await closedReason(db, clock(deps));
  if (closed) return { error: closed, code: "closed" };
  const conversation = await reloadConversation(deps);
  if (isActionError(conversation)) return conversation;
  const local = (await loadDeliverySettings(db)).quoteOptions.local;
  const found = deps.geocode
    ? await deps.geocode(input.address, local).catch(() => [])
    : isDemoMode()
      ? demoGeocode(input.address)
      : await geocodeAddress(input.address, local).catch(() => []);
  const place = found[0];
  if (!place) return { error: "No encontré esa dirección. Pedile calle, altura y barrio." };

  const items = input.items.map((i) => ({ productId: i.product_id, qty: i.qty }));
  const priced = await priceOrder(db, items, { address: place.label, lat: place.lat, lng: place.lng });
  if (!priced.ok) return failure(priced);

  const { lines, subtotal, fee, minOrder, zone } = priced.value;
  const draft: OrderDraft = {
    items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
    address: place.label.slice(0, 200),
    lat: place.lat,
    lng: place.lng,
    fee,
    subtotal,
    minOrder,
    quotedByMessageId: deps.messageId,
    quotedAt: clock(deps).toISOString(),
  };
  await db.from("wa_conversations").update({ state: withDraft(conversation.state, draft) as Json }).eq("id", conversation.id);

  return {
    lines: lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
    subtotal,
    delivery_fee: fee,
    total: subtotal + fee,
    zone,
    resolved_address: place.label,
    note: "Mostrale el resumen y preguntale si confirma. No crees el pedido hasta su respuesta.",
  };
}

export async function confirmOrder(deps: OrderActionDeps, input: ConfirmInput): Promise<ConfirmResult> {
  const { db } = deps;
  const closed = await closedReason(db, clock(deps));
  if (closed) return { error: closed, code: "closed" };
  const conversation = await reloadConversation(deps);
  if (isActionError(conversation)) return conversation;
  const check = mayConfirm(parseDraft(conversation.state), deps.messageId, clock(deps));
  if (!check.ok) return { error: check.reason, code: check.code };
  if (deps.dryRun) return { ok: true, dry_run: true, note: "Prueba: el pedido no se creó." };

  const { draft } = check;

  // Se reclama el borrador ANTES de crear el pedido: si dos "sí" llegan a la vez, solo uno
  // logra el update (el otro ve otro `updated_at`) y el segundo no crea un pedido duplicado.
  const { data: claimed } = await db
    .from("wa_conversations")
    .update({ state: withDraft(conversation.state, null) as Json })
    .eq("id", conversation.id)
    .eq("updated_at", conversation.updated_at)
    .select("id")
    .maybeSingle();
  if (!claimed) return { error: "Ya se está procesando tu confirmación. Esperá un momento.", code: "claim_lost" };

  const restoreDraft = () =>
    db.from("wa_conversations").update({ state: withDraft(conversation.state, draft) as Json }).eq("id", conversation.id);

  // Pasado el claim, cualquier excepción devuelve el borrador: si no, el cliente pierde la cotización.
  try {
    const result = await createFromDraft(deps, conversation, draft, input);
    if ("error" in result) await restoreDraft();
    return result;
  } catch (error: unknown) {
    console.error("[order-actions] confirmOrder falló después del claim", error);
    await restoreDraft().then(undefined, () => undefined);
    return { error: "No pude crear el pedido. Probá de nuevo en un momento." };
  }
}

async function createFromDraft(
  deps: OrderActionDeps,
  conversation: Conversation,
  draft: OrderDraft,
  input: ConfirmInput,
): Promise<ConfirmResult> {
  const { db } = deps;
  const order = {
    clientId: await ensureClientForConversation(db, conversation),
    items: draft.items,
    address: { address: draft.address, lat: draft.lat, lng: draft.lng },
    paymentMethod: input.payment_method,
    notes: input.notes,
    channel: "whatsapp" as const,
    actor: actorOf(deps),
    expectedTotal: draft.subtotal + draft.fee,
  };

  // Mercado Pago: no se crea el pedido, se abre el pago y se le pasa el link al cliente.
  if (input.payment_method === "Mercado Pago") {
    const gateway = (deps.gateway ?? getGateway)();
    const started = gateway
      ? await startOnlinePayment(db, gateway, order)
      : ({ ok: false, message: "El pago con Mercado Pago todavía no está habilitado. Ofrecé efectivo o tarjeta." } as const);
    if (!started.ok) return failure(started);
    return {
      ok: true,
      awaiting_payment: true,
      payment_url: started.value.url,
      total: started.value.total,
      note: "Mandale el link de pago al cliente. El pedido se confirma y pasa a la cocina cuando se acredite el pago; el link vence en 30 minutos.",
    };
  }

  const created = await createDeliveryOrder(db, order);
  // No se creó: el borrador vuelve (lo hace quien llama) para poder reintentar o recotizar.
  if (!created.ok) return failure(created);

  return {
    ok: true,
    order_code: `#${created.value.id.slice(0, 8).toUpperCase()}`,
    total: Number(created.value.total),
    payment_method: input.payment_method,
  };
}

export async function orderStatus(deps: OrderActionDeps): Promise<OrderStatusResult | ActionError> {
  const { db } = deps;
  const conversation = await reloadConversation(deps);
  if (isActionError(conversation)) return conversation;
  const clientId = conversation.client_id;
  const pending = clientId ? await latestPendingIntent(db, clientId, clock(deps)) : null;
  if (pending) {
    return { found: true, awaiting_payment: true, total: Number(pending.total), payment_url: pending.checkout_url, expires_at: pending.expires_at };
  }
  const order = await latestOrder(deps, clientId);
  if (!order) return { found: false };
  return {
    found: true,
    order_code: `#${order.id.slice(0, 8).toUpperCase()}`,
    status: order.status,
    items: order.items_desc,
    total: Number(order.total),
    courier: order.courier_name,
    minutes_since_order: minutesSince(order.created_at, clock(deps).getTime()),
  };
}

export async function cancelOrder(deps: OrderActionDeps): Promise<CancelResult> {
  const { db } = deps;
  const conversation = await reloadConversation(deps);
  if (isActionError(conversation)) return conversation;
  const pending = conversation.client_id ? await latestPendingIntent(db, conversation.client_id, clock(deps)) : null;
  if (pending && conversation.client_id) {
    if (deps.dryRun) return { ok: true, dry_run: true, note: "Prueba: el pago no se canceló." };
    return (await cancelPendingIntent(db, pending.id, conversation.client_id))
      ? { ok: true, note: "Se canceló el pago pendiente. No se cobró nada." }
      : { error: "Ese pago ya no se puede cancelar." };
  }
  const order = await latestOrder(deps, conversation.client_id);
  if (!order || !conversation.client_id) return { error: "No encontré un pedido para cancelar." };
  if (deps.dryRun) return { ok: true, dry_run: true, note: "Prueba: el pedido no se canceló." };

  const result = await cancelOrderForClient(db, order.id, conversation.client_id, actorOf(deps));
  return result.ok ? { ok: true } : { error: result.message };
}
