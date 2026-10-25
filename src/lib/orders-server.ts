import { createAdminClient } from "@/utils/supabase/admin";
import type { OrderChannel, OrderStatus } from "@/types/database";
import { pointsForTotal, tierForPoints, type TierRule } from "@/lib/orders";
import { REFUND_PREFIX } from "@/lib/rewards";

type Db = ReturnType<typeof createAdminClient>;

/** Pedido con los datos del cliente ya resueltos (lo que consumen tablero, mapa y repartidor). */
export interface EnrichedOrder {
  id: string;
  client_id: string | null;
  client_name: string;
  client_phone: string | null;
  status: OrderStatus;
  items_desc: string;
  total: number;
  delivery_fee: number;
  delivery_address: string | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  payment_method: string | null;
  notes: string | null;
  courier_name: string | null;
  channel: OrderChannel;
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  /** Dónde estaba el repartidor al marcar entregado. */
  delivered_lat: number | null;
  delivered_lng: number | null;
  created_at: string;
  updated_at: string;
}

interface RawOrder {
  id: string;
  client_id: string | null;
  status: OrderStatus;
  items_desc: string;
  total: number;
  delivery_fee?: number | null;
  delivery_address?: string | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  payment_method?: string | null;
  notes?: string | null;
  courier_name?: string | null;
  channel?: OrderChannel | null;
  accepted_at?: string | null;
  ready_at?: string | null;
  picked_up_at?: string | null;
  delivered_at?: string | null;
  delivered_lat?: number | null;
  delivered_lng?: number | null;
  created_at: string;
  updated_at?: string;
}

export async function readConfig(db: Db): Promise<Record<string, unknown>> {
  const { data } = await db.from("global_config").select("key, value");
  return Object.fromEntries((data ?? []).map((r) => [r.key, r.value]));
}

export function numberConfig(config: Record<string, unknown>, key: string, fallback: number): number {
  const value = Number(config[key]);
  return Number.isFinite(value) ? value : fallback;
}

export async function enrichOrders(db: Db, orders: RawOrder[]): Promise<EnrichedOrder[]> {
  const ids = [...new Set(orders.map((o) => o.client_id).filter((id): id is string => Boolean(id)))];
  const clientsById = new Map<string, { name: string; phone: string | null }>();
  if (ids.length > 0) {
    const { data } = await db.from("clients").select("id, name, phone").in("id", ids);
    for (const c of data ?? []) clientsById.set(c.id, { name: c.name, phone: c.phone });
  }

  return orders.map((o) => {
    const client = o.client_id ? clientsById.get(o.client_id) : undefined;
    return {
      id: o.id,
      client_id: o.client_id,
      client_name: client?.name ?? "Mostrador",
      client_phone: client?.phone ?? null,
      status: o.status,
      items_desc: o.items_desc,
      total: Number(o.total),
      delivery_fee: Number(o.delivery_fee ?? 0),
      delivery_address: o.delivery_address ?? null,
      delivery_lat: o.delivery_lat ?? null,
      delivery_lng: o.delivery_lng ?? null,
      payment_method: o.payment_method ?? null,
      notes: o.notes ?? null,
      courier_name: o.courier_name ?? null,
      channel: o.channel ?? "web",
      accepted_at: o.accepted_at ?? null,
      ready_at: o.ready_at ?? null,
      picked_up_at: o.picked_up_at ?? null,
      delivered_at: o.delivered_at ?? null,
      delivered_lat: o.delivered_lat ?? null,
      delivered_lng: o.delivered_lng ?? null,
      created_at: o.created_at,
      updated_at: o.updated_at ?? o.created_at,
    };
  });
}

export async function listOrders(
  db: Db,
  opts: { statuses?: readonly OrderStatus[]; excludeCancelled?: boolean; limit?: number } = {},
): Promise<EnrichedOrder[]> {
  let query = db.from("orders").select("*");
  if (opts.excludeCancelled) query = query.neq("status", "Cancelado");
  if (opts.statuses) query = query.in("status", [...opts.statuses]);
  const { data } = await query.order("created_at", { ascending: false }).limit(opts.limit ?? 100);
  return enrichOrders(db, (data ?? []) as unknown as RawOrder[]);
}

export async function getClientByUserId(db: Db, userId: string) {
  const { data } = await db
    .from("clients")
    .select("id, name, phone, address, total_points, tier")
    .eq("user_id", userId)
    .maybeSingle();
  return data;
}

export async function getClientById(db: Db, clientId: string) {
  const { data } = await db.from("clients").select("id, total_points").eq("id", clientId).maybeSingle();
  return data;
}

function tiersFromConfig(config: Record<string, unknown>): TierRule[] | undefined {
  const raw = config.niveles_lealtad;
  if (!Array.isArray(raw)) return undefined;
  const tiers = raw
    .map((n) => ({ nombre: String((n as TierRule).nombre), desde: Number((n as TierRule).desde) }))
    .filter((t) => t.nombre && Number.isFinite(t.desde));
  return tiers.length > 0 ? tiers : undefined;
}

/**
 * Suma al saldo del cliente (puede ser negativo para canjes) y recalcula su nivel.
 *
 * En la base real un trigger (`update_client_points`) ya actualiza
 * `clients.total_points` al insertar en `points_ledger`; acá se escribe el
 * saldo *absoluto* resultante, que coincide con el del trigger y además cubre
 * el modo demo (sin triggers) y el recálculo de `tier`.
 */
export async function applyPointsDelta(
  db: Db,
  clientId: string,
  delta: number,
  description: string,
  orderId: string | null,
): Promise<number> {
  const { data: client } = await db
    .from("clients")
    .select("total_points")
    .eq("id", clientId)
    .maybeSingle();
  if (!client) return 0;

  const config = await readConfig(db);
  const nextTotal = Math.max(0, client.total_points + delta);

  await db.from("points_ledger").insert({
    client_id: clientId,
    order_id: orderId,
    delta,
    description,
  });
  await db
    .from("clients")
    .update({ total_points: nextTotal, tier: tierForPoints(nextTotal, tiersFromConfig(config)) })
    .eq("id", clientId);

  return nextTotal;
}

/** Acredita los puntos de un pedido entregado. Idempotente por `order_id`. */
export async function awardPointsForOrder(db: Db, order: Pick<EnrichedOrder, "id" | "client_id" | "total" | "items_desc"> & { points_earned?: number | null }) {
  if (!order.client_id) return 0;

  // Solo cuentan las filas que suman: un canje descontado al crear el pedido también lleva `order_id`.
  const { data: existing } = await db
    .from("points_ledger")
    .select("id")
    .eq("order_id", order.id)
    .gt("delta", 0)
    .limit(1);
  if ((existing ?? []).length > 0) return 0;

  // Con detalle de platos los puntos ya se fijaron al crear el pedido; sin él (pedido de mostrador
  // o anterior a los puntos por plato) rige la tasa global de la configuración.
  const points =
    typeof order.points_earned === "number"
      ? order.points_earned
      : pointsForTotal(order.total, numberConfig(await readConfig(db), "puntos_por_100", 0.5));
  if (points <= 0) return 0;

  await applyPointsDelta(db, order.client_id, points, `Pedido ${order.items_desc}`, order.id);
  return points;
}

/**
 * Devuelve los puntos canjeados en un pedido que se canceló. Idempotente: descuenta lo ya devuelto,
 * así una segunda cancelación (cliente y admin a la vez) no acredita dos veces.
 */
export async function refundRedeemedPoints(db: Db, orderId: string): Promise<number> {
  const { data } = await db
    .from("points_ledger")
    .select("client_id, delta, description")
    .eq("order_id", orderId);
  const rows = data ?? [];

  const spent = rows.filter((r) => r.delta < 0).reduce((sum, r) => sum - r.delta, 0);
  const refunded = rows
    .filter((r) => r.delta > 0 && String(r.description).startsWith(REFUND_PREFIX))
    .reduce((sum, r) => sum + r.delta, 0);
  const owed = spent - refunded;
  const clientId = rows.find((r) => r.delta < 0)?.client_id;
  if (owed <= 0 || !clientId) return 0;

  await applyPointsDelta(db, clientId, owed, `${REFUND_PREFIX}pedido cancelado`, orderId);
  return owed;
}
