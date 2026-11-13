import { isSameDayAR } from "./time-ar.ts";
/** Métricas de una entrega a partir de las marcas de tiempo y del punto donde se marcó entregado. */

export interface DeliveryTimes {
  /** Del pedido a la entrega: lo que esperó el cliente. */
  totalMin: number | null;
  /** De la salida del repartidor a la entrega: el viaje. */
  rideMin: number | null;
}

interface TimedOrder {
  created_at: string;
  picked_up_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
}

const minutesBetween = (from: string | null, to: string | null): number | null => {
  if (!from || !to) return null;
  const ms = new Date(to).getTime() - new Date(from).getTime();
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 60_000) : null;
};

export function deliveryTimes(order: TimedOrder): DeliveryTimes {
  return {
    totalMin: minutesBetween(order.created_at, order.delivered_at),
    // Si no marcó "salí", se toma desde que el pedido quedó listo.
    rideMin: minutesBetween(order.picked_up_at ?? order.ready_at, order.delivered_at),
  };
}

const EARTH_RADIUS_M = 6_371_000;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Distancia en metros entre dos puntos (haversine). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h)));
}

/** ¿`iso` cae el mismo día argentino que `now`? (antes usaba la zona del entorno: UTC en el Worker). */
export function isSameLocalDay(iso: string | null, now: Date = new Date()): boolean {
  if (!iso) return false;
  return isSameDayAR(iso, now);
}

/** Dónde marcar una entrega: el punto real del repartidor o, sin él, la dirección del pedido. No depende de tener repartidor. */
export function deliveredPoint(order: {
  delivered_lat: number | null;
  delivered_lng: number | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
}): { lat: number; lng: number } | null {
  if (order.delivered_lat !== null && order.delivered_lng !== null) return { lat: order.delivered_lat, lng: order.delivered_lng };
  if (order.delivery_lat !== null && order.delivery_lng !== null) return { lat: order.delivery_lat, lng: order.delivery_lng };
  return null;
}
