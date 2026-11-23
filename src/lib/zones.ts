import { calcDeliveryFee, haversineKm } from "./restaurant.ts";

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** Forma de una zona de entrega. Los puntos del polígono van como [lat, lng]. */
export type ZoneShape =
  | { type: "circle"; lat: number; lng: number; radius_km: number }
  | { type: "polygon"; points: ReadonlyArray<readonly [number, number]> };

export interface DeliveryZone {
  id: string;
  name: string;
  shape: ZoneShape;
  /** Costo de envío fijo de la zona. */
  fee: number;
  /** Monto mínimo de pedido (0 = sin mínimo). */
  min_order: number;
  /** Orden de prioridad: si dos zonas se superponen gana la de menor número. */
  sort_order: number;
  is_active: boolean;
}

export function pointInShape(point: GeoPoint, shape: ZoneShape): boolean {
  if (shape.type === "circle") {
    return haversineKm(point, shape) <= shape.radius_km;
  }

  const { points } = shape;
  if (points.length < 3) return false;

  // Ray casting: cuenta cuántas aristas cruza un rayo horizontal desde el punto.
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [latI, lngI] = points[i]!;
    const [latJ, lngJ] = points[j]!;
    const crosses =
      latI > point.lat !== latJ > point.lat &&
      point.lng < ((lngJ - lngI) * (point.lat - latI)) / (latJ - latI) + lngI;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Primera zona activa (por `sort_order`) que contiene el punto. */
export function findZone(point: GeoPoint, zones: readonly DeliveryZone[]): DeliveryZone | null {
  return findZoneIn(point, orderZones(zones));
}

/** Zonas activas por `sort_order`; se calcula una vez para buscar muchos puntos con `findZoneIn`. */
export function orderZones(zones: readonly DeliveryZone[]): DeliveryZone[] {
  return zones.filter((z) => z.is_active).sort((a, b) => a.sort_order - b.sort_order);
}

/** Como `findZone`, pero con zonas ya filtradas y ordenadas por `orderZones`. */
export function findZoneIn(point: GeoPoint, ordered: readonly DeliveryZone[]): DeliveryZone | null {
  return ordered.find((z) => pointInShape(point, z.shape)) ?? null;
}

export type DeliveryQuote =
  | { covered: true; fee: number; minOrder: number; zone: string | null; freeZoneAvailable: boolean }
  | { covered: false; reason: string };

/** Radio máximo (km) de las zonas activas si todas son círculos; null si no hay zonas o alguna es un polígono. */
export function maxCircleRadiusKm(zones: readonly DeliveryZone[]): number | null {
  const active = zones.filter((z) => z.is_active);
  if (active.length === 0 || active.some((z) => z.shape.type !== "circle")) return null;
  return Math.max(...active.map((z) => (z.shape.type === "circle" ? z.shape.radius_km : 0)));
}

/** Mensaje fijo cuando la dirección (ya resuelta por el geocoder) cae fuera de todas las zonas. */
export function outOfZoneReason(zones: readonly DeliveryZone[]): string {
  const km = maxCircleRadiusKm(zones);
  if (km === null || km <= 0) return "Por ahora no llegamos a esa dirección.";
  const text = Number.isInteger(km) ? String(km) : String(Math.round(km * 10) / 10).replace(".", ",");
  return `Por ahora no llegamos a esa dirección: entregamos hasta ${text} km del local.`;
}

interface QuoteOptions {
  local: GeoPoint;
  /** Radio máximo (km) cuando no hay zonas configuradas. */
  radiusKm: number;
  costPerKm: number;
}

/**
 * Cobertura y costo de envío. Con zonas activas manda la zona (tarifa fija);
 * sin zonas se usa el modelo anterior: radio desde el local + costo por km.
 */
export function quoteDelivery(
  point: GeoPoint,
  zones: readonly DeliveryZone[],
  { local, radiusKm, costPerKm }: QuoteOptions,
): DeliveryQuote {
  if (zones.some((z) => z.is_active)) {
    const zone = findZone(point, zones);
    if (!zone) return { covered: false, reason: outOfZoneReason(zones) };
    // Hay una zona de envío gratis y esta dirección no cae en ella: el recargo se avisa (dato del servidor, no del modelo).
    const freeZoneAvailable = zone.fee > 0 && zones.some((z) => z.is_active && z.fee === 0);
    return { covered: true, fee: zone.fee, minOrder: zone.min_order, zone: zone.name, freeZoneAvailable };
  }

  const distanceKm = haversineKm(local, point);
  if (distanceKm > radiusKm) {
    return { covered: false, reason: `Tu dirección está fuera de la zona de entrega (${radiusKm} km).` };
  }
  return { covered: true, fee: calcDeliveryFee(distanceKm, costPerKm), minOrder: 0, zone: null, freeZoneAvailable: false };
}
