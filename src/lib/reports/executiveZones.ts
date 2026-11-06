import { findZoneIn, orderZones, type DeliveryZone } from "../zones.ts";
import type { ExecutiveOrder, ReviewInput, ZoneOf } from "./executive.ts";

export interface OrderCoords {
  id: string;
  delivery_lat: number | string | null;
  delivery_lng: number | string | null;
}

export interface ReviewRow {
  id?: string;
  order_id: string | null;
  rating: number;
  feedback: string | null;
  created_at: string;
}

const toCoord = (v: number | string | null): number | null => {
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Arma `zoneOf` y los nombres reales por id a partir de las coordenadas de entrega de cada pedido. */
export function buildZoneResolver(
  coords: readonly OrderCoords[],
  zones: readonly DeliveryZone[],
): { zoneOf: ZoneOf; zoneNames: Record<string, string> } {
  const zoneByOrder = new Map<string, string>();
  const ordered = orderZones(zones);
  for (const c of coords) {
    const lat = toCoord(c.delivery_lat);
    const lng = toCoord(c.delivery_lng);
    if (lat === null || lng === null) continue;
    const zone = findZoneIn({ lat, lng }, ordered);
    if (zone) zoneByOrder.set(c.id, zone.id);
  }
  return {
    zoneOf: (order: ExecutiveOrder) => zoneByOrder.get(order.id) ?? null,
    zoneNames: Object.fromEntries(zones.map((z) => [z.id, z.name])),
  };
}

/** Reseñas de la base -> entrada del snapshot (el texto de la reseña es `feedback`). */
export function toReviewInputs(rows: readonly ReviewRow[]): ReviewInput[] {
  return rows.map((r) => ({
    rating: Number(r.rating),
    created_at: r.created_at,
    order_id: r.order_id,
    comment: r.feedback,
  }));
}

export interface PageCursor { created_at: string; id: string }

export interface CursorPage<Row> {
  data: Row[] | null;
  error: { message: string } | null;
}

/**
 * Lee todas las filas de a páginas, de la más nueva a la más vieja, con cursor (created_at, id) para que
 * el desempate sea estable. Si llega a `maxPages` con la última página llena, avisa con `truncated: true`
 * en vez de cortar en silencio.
 */
export async function fetchByCursor<Row extends { created_at: string; id: string }>(
  page: (cursor: PageCursor | null) => PromiseLike<CursorPage<Row>>,
  pageSize: number,
  maxPages: number,
): Promise<{ rows: Row[]; truncated: boolean }> {
  const rows: Row[] = [];
  let cursor: PageCursor | null = null;
  for (let i = 0; i < maxPages; i++) {
    const { data, error } = await page(cursor);
    if (error) throw new Error(`No se pudieron leer los datos: ${error.message}`);
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, truncated: false };
    const last = batch[batch.length - 1];
    cursor = { created_at: last.created_at, id: last.id };
  }
  return { rows, truncated: true };
}
