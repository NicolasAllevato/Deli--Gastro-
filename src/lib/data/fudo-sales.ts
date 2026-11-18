import { requireStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

/**
 * Ventas en Fudo para pedidos de la app y de WhatsApp (D1 como fuente). Ver GUIA_INTEGRACION_FUDO §7.3.
 *
 * - Confirmar (→ En Preparación) crea la venta; Finalizados registra el pago y la cierra; Cancelado la anula.
 * - Idempotente: el pedido se "toma" con un UPDATE condicional (fudo_sale_sync = 'sending') y guarda
 *   fudo_sale_id. Además el Worker recuerda la venta por externalId (el id del pedido).
 * - Nunca tira por Fudo: si las escrituras están apagadas o Fudo falla, el pedido queda 'pending' y el
 *   admin lo reintenta. Cada escritura (éxito y fallo) queda en fudo_writes.
 * - Los pedidos que vinieron de Fudo (channel 'fudo' o fudo_order_id) nunca se re-envían.
 */

export type GatewayResult =
  | { ok: true; status: number; data: unknown }
  | { ok: false; status: number; error: string; code?: string };

/** Escritura firmada al Worker fudo-gateway. Inyectada para poder testear sin red. */
export type FudoWriteGateway = (method: "POST" | "PATCH", path: string, body: unknown) => Promise<GatewayResult>;

export type SaleSyncResult = "sent" | "partial" | "pending" | "skipped";

/** Un 'sending' más viejo que esto se considera abandonado (el Worker igual no duplica por externalId). */
const STALE_CLAIM_MS = 5 * 60_000;
const MAX_ERROR = 500;

type Operation = "create_sale" | "close_sale" | "cancel_sale" | "payment";

function actorLabel(actor: Actor): string {
  if (actor.kind === "system") return `system:${actor.reason}`.slice(0, 120);
  if (actor.kind === "anon") return "anon";
  return `${actor.kind}:${actor.userId}`.slice(0, 120);
}

async function audit(
  db: SqlDatabase,
  actor: Actor,
  entry: { orderId: string; operation: Operation; fudoId: number | null; ok: boolean; status: number | null; error: string | null; payload: unknown },
): Promise<void> {
  try {
    await db
      .prepare("INSERT INTO fudo_writes (id, order_id, operation, fudo_id, ok, http_status, error, payload, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(
        crypto.randomUUID(),
        entry.orderId,
        entry.operation,
        entry.fudoId,
        entry.ok ? 1 : 0,
        entry.status,
        entry.error ? entry.error.slice(0, MAX_ERROR) : null,
        JSON.stringify(entry.payload ?? null).slice(0, 20000),
        actorLabel(actor),
      )
      .run();
  } catch (e) {
    // Una falla de auditoría nunca rompe la escritura ya aplicada en Fudo.
    console.error("[fudo-sales] auditoría", e instanceof Error ? e.message : String(e));
  }
}

async function callGateway(gw: FudoWriteGateway, method: "POST" | "PATCH", path: string, body: unknown): Promise<GatewayResult> {
  try {
    return await gw(method, path, body);
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "No se pudo contactar al gateway de Fudo." };
  }
}

function gatewayError(r: Extract<GatewayResult, { ok: false }>): string {
  return r.code === "WRITES_DISABLED" ? "Escrituras en Fudo deshabilitadas (ENABLE_WRITES)." : r.error;
}

/** El gateway rechazó sin tocar Fudo (o Fudo rechazó con 4xx): reintentar no duplica nada. Timeout/5xx = incierto. */
function definitiveFailure(r: Extract<GatewayResult, { ok: false }>): boolean {
  if (r.code === "WRITES_DISABLED" || r.code === "NOT_CONFIGURED") return true;
  return r.status >= 400 && r.status < 500 && r.status !== 408;
}

interface OrderForSale {
  id: string;
  status: string;
  total_cents: number;
  delivery_address: string | null;
  payment_method: string | null;
  notes: string | null;
  customer_name: string | null;
  client_name: string | null;
  client_phone: string | null;
}

interface LineRow {
  name: string;
  qty: number;
  unit_price_cents: number;
  fudo_product_id: number | null;
}

/**
 * Interruptor de `global_config.bot_orders_fudo_enabled`: los pedidos del bot de WhatsApp (canal `whatsapp`) solo
 * crean venta en Fudo con el valor `true`. Ausente o cualquier otro valor = apagado (piloto de pruebas sin ventas reales).
 */
export const BOT_ORDERS_FUDO_KEY = "bot_orders_fudo_enabled";

/** Toma el pedido para crear su venta. false: ya tiene venta, viene de Fudo, está cancelado, es del bot con el interruptor apagado u otro proceso lo tiene. */
async function claimForSale(db: SqlDatabase, orderId: string): Promise<boolean> {
  const staleBefore = new Date(Date.now() - STALE_CLAIM_MS).toISOString();
  const r = await db
    .prepare(
      `UPDATE orders SET fudo_sale_sync = 'sending', fudo_sale_claimed_at = ?, fudo_sale_error = NULL
       WHERE id = ? AND channel <> 'fudo' AND fudo_order_id IS NULL AND fudo_sale_id IS NULL AND status <> 'Cancelado'
         AND (channel <> 'whatsapp' OR EXISTS (
           SELECT 1 FROM global_config WHERE key = 'bot_orders_fudo_enabled' AND value IN ('true', '"true"')))
         AND (fudo_sale_sync IS NULL OR fudo_sale_sync = 'pending' OR (fudo_sale_sync = 'sending' AND fudo_sale_claimed_at < ?))`,
    )
    .bind(nowIso(), orderId, staleBefore)
    .run();
  return r.meta.changes === 1;
}

async function markPending(db: SqlDatabase, orderId: string, error: string): Promise<void> {
  await db
    .prepare("UPDATE orders SET fudo_sale_sync = 'pending', fudo_sale_error = ? WHERE id = ? AND fudo_sale_sync = 'sending'")
    .bind(error.slice(0, MAX_ERROR), orderId)
    .run();
}

type Built = { ok: true; body: Record<string, unknown> } | { ok: false; reason: string };

/** Arma el cuerpo de POST /sales. Delivery = hay dirección: va como TAKEAWAY con dirección y teléfono (lo hace el Worker). */
export function buildSaleBody(order: OrderForSale, lines: readonly LineRow[]): Built {
  if (lines.length === 0) return { ok: false, reason: "El pedido no tiene ítems." };
  if (lines.length > 100) return { ok: false, reason: "Más de 100 líneas: cargar a mano en Fudo." };
  const unmapped = lines.filter((l) => l.fudo_product_id === null).map((l) => l.name);
  if (unmapped.length > 0) return { ok: false, reason: `Producto sin mapear a Fudo: ${unmapped.join(", ")}` };
  return {
    ok: true,
    body: {
      externalId: order.id,
      lines: lines.map((l) => ({ fudoProductId: l.fudo_product_id, quantity: l.qty, price: l.unit_price_cents / 100, comment: null })),
      customerName: order.customer_name ?? order.client_name,
      comment: order.notes,
      delivery: order.delivery_address ? { address: order.delivery_address, phone: order.client_phone } : null,
    },
  };
}

async function loadOrder(db: SqlDatabase, orderId: string): Promise<OrderForSale | null> {
  return db
    .prepare(
      `SELECT o.id, o.status, o.total_cents, o.delivery_address, o.payment_method, o.notes, o.customer_name,
              c.name AS client_name, c.phone AS client_phone
       FROM orders o LEFT JOIN clients c ON c.id = o.client_id WHERE o.id = ?`,
    )
    .bind(orderId)
    .first<OrderForSale>();
}

async function loadLines(db: SqlDatabase, orderId: string): Promise<LineRow[]> {
  const { results } = await db
    .prepare(
      `SELECT i.name, i.qty, i.unit_price_cents, COALESCE(m.fudo_product_id, p.fudo_id) AS fudo_product_id
       FROM order_items i
       LEFT JOIN fudo_product_map m ON m.product_id = i.product_id
       LEFT JOIN products p ON p.id = i.product_id
       WHERE i.order_id = ? ORDER BY i.created_at, i.id`,
    )
    .bind(orderId)
    .all<LineRow>();
  return results;
}

function saleData(data: unknown): { saleId: number; partial: boolean } | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { saleId?: unknown; partial?: unknown };
  return typeof d.saleId === "number" && Number.isInteger(d.saleId) && d.saleId > 0 ? { saleId: d.saleId, partial: d.partial === true } : null;
}

/** Crea la venta en Fudo para un pedido confirmado. Nunca tira por errores de Fudo. */
export async function pushOrderSale(db: SqlDatabase, actor: Actor, gw: FudoWriteGateway, orderId: string): Promise<{ result: SaleSyncResult; error?: string }> {
  requireStaff(actor);
  if (!(await claimForSale(db, orderId))) return { result: "skipped" };
  const order = await loadOrder(db, orderId);
  if (!order) return { result: "skipped" };
  const built = buildSaleBody(order, await loadLines(db, orderId));
  if (!built.ok) {
    await markPending(db, orderId, built.reason);
    return { result: "pending", error: built.reason };
  }
  const res = await callGateway(gw, "POST", "/sales", built.body);
  const sale = res.ok ? saleData(res.data) : null;
  if (!res.ok || !sale) {
    const error = res.ok ? "El gateway no devolvió el id de la venta." : gatewayError(res);
    await audit(db, actor, { orderId, operation: "create_sale", fudoId: null, ok: false, status: res.status, error, payload: built.body });
    await markPending(db, orderId, error);
    return { result: "pending", error };
  }
  const result: SaleSyncResult = sale.partial ? "partial" : "sent";
  await db
    .prepare("UPDATE orders SET fudo_sale_id = ?, fudo_sale_sync = ?, fudo_sale_error = ? WHERE id = ?")
    .bind(sale.saleId, result, sale.partial ? "Alguna línea no se cargó en Fudo: revisar la venta allá." : null, orderId)
    .run();
  await audit(db, actor, { orderId, operation: "create_sale", fudoId: sale.saleId, ok: true, status: res.status, error: null, payload: { ...built.body, response: res.data } });
  // Si el pedido se canceló mientras se creaba la venta, el cancelSale de ese momento no la vio: se anula acá.
  const now = await loadSaleState(db, orderId);
  if (now?.status === "Cancelado") await changeState(db, actor, gw, orderId, sale.saleId, "CANCELED");
  return { result };
}

interface SaleState {
  status: string;
  fudo_sale_id: number | null;
  payment_method: string | null;
  total_cents: number;
  fudo_payment_method_id: number | null;
}

async function loadSaleState(db: SqlDatabase, orderId: string): Promise<SaleState | null> {
  return db
    .prepare(
      `SELECT o.status, o.fudo_sale_id, o.payment_method, o.total_cents, m.fudo_payment_method_id
       FROM orders o LEFT JOIN fudo_payment_map m ON m.payment_method = o.payment_method WHERE o.id = ?`,
    )
    .bind(orderId)
    .first<SaleState>();
}

async function noteError(db: SqlDatabase, orderId: string, error: string): Promise<void> {
  await db.prepare("UPDATE orders SET fudo_sale_error = ? WHERE id = ?").bind(error.slice(0, MAX_ERROR), orderId).run();
}

/** Pago al cobrar (pedido Finalizados) y cierre de la venta. Cada paso se toma una sola vez. */
async function settleSale(db: SqlDatabase, actor: Actor, gw: FudoWriteGateway, orderId: string): Promise<void> {
  const s = await loadSaleState(db, orderId);
  if (!s?.fudo_sale_id || s.status !== "Finalizados") return;
  const saleId = s.fudo_sale_id;
  if (s.fudo_payment_method_id === null) {
    await noteError(db, orderId, `Medio de pago sin mapear a Fudo: ${s.payment_method ?? "sin medio"}`);
  } else {
    const claim = await db.prepare("UPDATE orders SET fudo_sale_paid_at = ? WHERE id = ? AND fudo_sale_paid_at IS NULL").bind(nowIso(), orderId).run();
    if (claim.meta.changes === 1) {
      const body = { saleId, paymentMethodId: s.fudo_payment_method_id, amount: s.total_cents / 100 };
      const res = await callGateway(gw, "POST", "/payments", body);
      const paymentId = res.ok ? ((res.data as { paymentId?: unknown } | null)?.paymentId ?? null) : null;
      await audit(db, actor, { orderId, operation: "payment", fudoId: typeof paymentId === "number" ? paymentId : null, ok: res.ok, status: res.status, error: res.ok ? null : gatewayError(res), payload: body });
      if (!res.ok) {
        if (definitiveFailure(res)) {
          await db.prepare("UPDATE orders SET fudo_sale_paid_at = NULL, fudo_sale_error = ? WHERE id = ?").bind(`No se pudo registrar el pago: ${gatewayError(res)}`.slice(0, MAX_ERROR), orderId).run();
        } else {
          // Resultado incierto (timeout/5xx): Fudo pudo haber cobrado. No se libera para no duplicar el pago.
          await noteError(db, orderId, `Pago incierto (${gatewayError(res)}): verificar en Fudo; «Reintentar» solo cierra la venta.`);
        }
        return;
      }
    }
  }
  await changeState(db, actor, gw, orderId, saleId, "CLOSED");
}

const STATE_SQL = {
  CLOSED: {
    claim: "UPDATE orders SET fudo_sale_closed_at = ? WHERE id = ? AND fudo_sale_closed_at IS NULL",
    release: "UPDATE orders SET fudo_sale_closed_at = NULL, fudo_sale_error = ? WHERE id = ?",
    operation: "close_sale",
    verb: "cerrar",
  },
  CANCELED: {
    claim: "UPDATE orders SET fudo_sale_canceled_at = ? WHERE id = ? AND fudo_sale_canceled_at IS NULL",
    release: "UPDATE orders SET fudo_sale_canceled_at = NULL, fudo_sale_error = ? WHERE id = ?",
    operation: "cancel_sale",
    verb: "anular",
  },
} as const;

async function changeState(db: SqlDatabase, actor: Actor, gw: FudoWriteGateway, orderId: string, saleId: number, state: "CLOSED" | "CANCELED"): Promise<void> {
  const sql = STATE_SQL[state];
  const claim = await db.prepare(sql.claim).bind(nowIso(), orderId).run();
  if (claim.meta.changes !== 1) return;
  const body = { state };
  const res = await callGateway(gw, "PATCH", `/sales/${saleId}/state`, body);
  await audit(db, actor, { orderId, operation: sql.operation, fudoId: saleId, ok: res.ok, status: res.status, error: res.ok ? null : gatewayError(res), payload: body });
  if (res.ok) {
    // Paso completo: sale de la lista de pendientes (la nota de una venta parcial se conserva).
    await db.prepare("UPDATE orders SET fudo_sale_error = NULL WHERE id = ? AND fudo_sale_sync <> 'partial'").bind(orderId).run();
  } else {
    await db.prepare(sql.release).bind(`No se pudo ${sql.verb} la venta en Fudo: ${gatewayError(res)}`.slice(0, MAX_ERROR), orderId).run();
  }
}

async function cancelSale(db: SqlDatabase, actor: Actor, gw: FudoWriteGateway, orderId: string): Promise<void> {
  const s = await loadSaleState(db, orderId);
  if (s?.fudo_sale_id) await changeState(db, actor, gw, orderId, s.fudo_sale_id, "CANCELED");
}

/** Reacción al cambio de estado del pedido (ya aplicado). Nunca tira por Fudo. */
export async function onOrderStatusChange(db: SqlDatabase, actor: Actor, gw: FudoWriteGateway, orderId: string, status: string): Promise<void> {
  requireStaff(actor);
  // En Camino/Finalizados también crean la venta si el pedido salteó «En Preparación» (pushOrderSale es idempotente).
  if (status === "En Preparación" || status === "En Camino") await pushOrderSale(db, actor, gw, orderId);
  else if (status === "Finalizados") {
    await pushOrderSale(db, actor, gw, orderId);
    await settleSale(db, actor, gw, orderId);
  }
  else if (status === "Cancelado") await cancelSale(db, actor, gw, orderId);
}

/** Botón «Reintentar» del admin: crea la venta si falta y completa pago/cierre/anulación pendientes. */
export async function retryOrderSale(db: SqlDatabase, actor: Actor, gw: FudoWriteGateway, orderId: string): Promise<{ result: SaleSyncResult; error?: string }> {
  requireStaff(actor);
  const pushed = await pushOrderSale(db, actor, gw, orderId);
  const s = await loadSaleState(db, orderId);
  if (s?.status === "Finalizados") await settleSale(db, actor, gw, orderId);
  if (s?.status === "Cancelado") await cancelSale(db, actor, gw, orderId);
  return pushed;
}

export interface PendingSale {
  id: string;
  status: string;
  created_at: string;
  total_cents: number;
  fudo_sale_id: number | null;
  fudo_sale_sync: string | null;
  fudo_sale_error: string | null;
}

/** Pedidos con la venta en Fudo pendiente, parcial o con un paso (pago, cierre, anulación) fallido. */
export async function listPendingSales(db: SqlDatabase, actor: Actor, limit = 50): Promise<PendingSale[]> {
  requireStaff(actor);
  const lim = Math.min(Math.max(limit, 1), 200);
  const { results } = await db
    .prepare(
      `SELECT id, status, created_at, total_cents, fudo_sale_id, fudo_sale_sync, fudo_sale_error FROM orders
       WHERE (fudo_sale_sync IN ('pending','partial','sending') AND status <> 'Cancelado')
          OR (fudo_sale_id IS NOT NULL AND fudo_sale_error IS NOT NULL AND fudo_sale_sync <> 'partial')
       ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(lim)
    .all<PendingSale>();
  return results;
}
