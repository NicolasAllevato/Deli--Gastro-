import type { createAdminClient } from "@/utils/supabase/admin";
import type { Database, OrderStatus } from "@/types/database";
import { stagePatch, type StagePatch } from "@/lib/tracking";
import { awardPointsForOrder } from "@/lib/orders-server";
import { cancelOrderBySystem, settleCancellation } from "@/lib/orders-create";
import { notifyOrderEvent, type OrderNotice } from "@/lib/whatsapp/notify";

type Db = ReturnType<typeof createAdminClient>;
type OrderRow = Database["public"]["Tables"]["orders"]["Row"];

export const FUDO_EVENTS = [
  "ORDER-REJECTED",
  "ORDER-CONFIRMED",
  "ORDER-READY-TO-DELIVER",
  "ORDER-DELIVERY-SENT",
  "ORDER-CLOSED",
] as const;
export type FudoEvent = (typeof FUDO_EVENTS)[number];

/** Estado de Deli-Gastro al que lleva cada webhook de Fudo (ver docs/FUDO_INTEGRACION.md §3). */
export const STATUS_BY_EVENT: Record<FudoEvent, OrderStatus> = {
  "ORDER-REJECTED": "Cancelado",
  "ORDER-CONFIRMED": "En Preparación",
  "ORDER-READY-TO-DELIVER": "En Camino",
  "ORDER-DELIVERY-SENT": "En Camino",
  "ORDER-CLOSED": "Finalizados",
};

const ORDER: readonly OrderStatus[] = ["Recibidos", "En Preparación", "En Camino", "Finalizados"];

/**
 * Fudo puede saltear pasos (cerrar un pedido que nunca vimos confirmado) y los webhooks pueden
 * llegar repetidos o desordenados: solo se avanza, nunca se vuelve atrás ni se sale de un estado final.
 */
export function fudoTransition(from: OrderStatus, to: OrderStatus): boolean {
  if (from === "Finalizados" || from === "Cancelado") return false;
  if (to === "Cancelado") return true;
  return ORDER.indexOf(to) > ORDER.indexOf(from);
}

export interface FudoStatusInput {
  event: FudoEvent;
  orderId?: string;
  fudoOrderId?: number;
}

export type FudoStatusResult =
  | { applied: true; status: OrderStatus }
  | { applied: false; reason: "not_found" | "ignored" | "conflict" };

async function findOrder(db: Db, input: FudoStatusInput): Promise<OrderRow | null> {
  if (input.fudoOrderId !== undefined) {
    const { data } = await db.from("orders").select("*").eq("fudo_order_id", input.fudoOrderId).maybeSingle();
    if (data) return data;
  }
  if (!input.orderId) return null;
  const { data } = await db.from("orders").select("*").eq("id", input.orderId).maybeSingle();
  return data;
}

/** Aplica en Deli-Gastro un cambio de estado hecho en Fudo, con los mismos efectos que el tablero. */
export async function applyFudoStatus(db: Db, input: FudoStatusInput): Promise<FudoStatusResult> {
  const order = await findOrder(db, input);
  if (!order) return { applied: false, reason: "not_found" };

  const target = STATUS_BY_EVENT[input.event];
  // "Listo para entregar" y "salió" caen los dos en En Camino: el segundo solo marca la salida.
  if (input.event === "ORDER-DELIVERY-SENT" && order.status === "En Camino") {
    if (!order.picked_up_at) {
      await db.from("orders").update({ picked_up_at: new Date().toISOString() }).eq("id", order.id);
      await db.from("order_events").insert({ order_id: order.id, event: "picked_up", actor: "fudo" });
    }
    return { applied: true, status: order.status };
  }
  if (!fudoTransition(order.status, target)) return { applied: false, reason: "ignored" };

  if (target === "Cancelado") {
    const cancelled = await cancelOrderBySystem(db, order.id, "fudo");
    if (!cancelled) return { applied: false, reason: "conflict" };
    await settleCancellation(db, order.id);
    return { applied: true, status: target };
  }

  // Al saltear pasos se completan las marcas de tiempo que faltan, para que el seguimiento no quede vacío.
  const patch: { status: OrderStatus; picked_up_at?: string } & StagePatch = { status: target };
  for (const step of ORDER.slice(ORDER.indexOf(order.status) + 1, ORDER.indexOf(target) + 1)) {
    Object.assign(patch, stagePatch(step));
  }
  if (input.event === "ORDER-DELIVERY-SENT" && !order.picked_up_at) patch.picked_up_at = new Date().toISOString();

  const { data, error } = await db.from("orders").update(patch).eq("id", order.id).eq("status", order.status).select().maybeSingle();
  if (error || !data) return { applied: false, reason: "conflict" };

  await db.from("order_events").insert({ order_id: data.id, event: target, actor: "fudo", detail: input.event });
  await notifyOrderEvent(db, data.id, target as OrderNotice);
  if (target === "Finalizados") {
    await awardPointsForOrder(db, {
      id: data.id,
      client_id: data.client_id,
      total: Number(data.total),
      items_desc: data.items_desc,
      points_earned: data.points_earned,
    });
  }
  return { applied: true, status: target };
}
