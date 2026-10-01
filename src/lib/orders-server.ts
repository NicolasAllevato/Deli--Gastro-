import { createAdminClient } from "@/utils/supabase/admin";
import type { OrderStatus } from "@/types/database";
import { pointsForTotal, tierForPoints, type TierRule } from "@/lib/orders";

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
export async function awardPointsForOrder(db: Db, order: Pick<EnrichedOrder, "id" | "client_id" | "total" | "items_desc">) {
  if (!order.client_id) return 0;

  const { data: existing } = await db
    .from("points_ledger")
    .select("id")
    .eq("order_id", order.id)
    .limit(1);
  if ((existing ?? []).length > 0) return 0;

  const config = await readConfig(db);
  const points = pointsForTotal(order.total, numberConfig(config, "puntos_por_100", 0.5));
  if (points <= 0) return 0;

  await applyPointsDelta(db, order.client_id, points, `Pedido ${order.items_desc}`, order.id);
  return points;
}
