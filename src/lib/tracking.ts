import type { OrderStatus } from "@/types/database";

/** Hora en que el pedido llegó a cada etapa (null = todavía no ocurrió). */
export interface StageTimestamps {
  accepted_at: string | null;
  ready_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
}

export type StagePatch = Partial<Record<keyof StageTimestamps, string>>;

/**
 * Columna de tiempo que se completa al entrar en `status`.
 * `picked_up_at` no sale de un cambio de estado: lo fija el repartidor al salir.
 */
const COLUMN_BY_STATUS: Partial<Record<OrderStatus, keyof StageTimestamps>> = {
  "En Preparación": "accepted_at",
  "En Camino": "ready_at",
  Finalizados: "delivered_at",
};

export function stagePatch(status: OrderStatus, now: Date = new Date()): StagePatch {
  const column = COLUMN_BY_STATUS[status];
  return column ? { [column]: now.toISOString() } : {};
}

export interface CourierPatchBody {
  status?: OrderStatus;
  courier_name?: string | null;
  picked_up?: true;
}

/**
 * Qué puede hacer un repartidor sobre un pedido. Una sola acción por pedido:
 * tomarlo (libre), marcar que salió (propio) o entregarlo (propio o libre).
 */
export function courierMayPatch(
  current: { status: OrderStatus; courier_name: string | null },
  courierName: string,
  body: CourierPatchBody,
): boolean {
  if (current.status !== "En Camino") return false;
  const free = current.courier_name === null;
  const mine = current.courier_name === courierName;
  const noStatus = body.status === undefined;
  const noAssign = body.courier_name === undefined;
  const noPickup = body.picked_up === undefined;

  const takes = noStatus && noPickup && body.courier_name === courierName && free;
  const pickedUp = noStatus && noAssign && body.picked_up === true && mine;
  const delivers = body.status === "Finalizados" && noAssign && noPickup && (free || mine);
  return takes || pickedUp || delivers;
}

/** Minutos por etapa; null cuando falta alguno de los dos extremos. */
export interface TrackingDurations {
  /** Cocina: aceptado → listo. */
  kitchen: number | null;
  /** Espera de despacho: listo → el repartidor salió. */
  dispatchWait: number | null;
  /** Ruta: el repartidor salió → entregado. */
  route: number | null;
  /** Total: pedido creado → entregado. */
  total: number | null;
}

function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const diff = new Date(to).getTime() - new Date(from).getTime();
  if (Number.isNaN(diff)) return null;
  return Math.max(0, Math.round(diff / 60_000));
}

export function computeDurations(
  order: StageTimestamps & { created_at: string },
): TrackingDurations {
  return {
    kitchen: minutesBetween(order.accepted_at, order.ready_at),
    dispatchWait: minutesBetween(order.ready_at, order.picked_up_at),
    route: minutesBetween(order.picked_up_at, order.delivered_at),
    total: minutesBetween(order.created_at, order.delivered_at),
  };
}
