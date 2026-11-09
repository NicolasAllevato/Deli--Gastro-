import type { createAdminClient } from "@/utils/supabase/admin";
import { deliveredPoint } from "@/lib/delivery-metrics";
import {
  LIST_LIMIT,
  MAX_MARKERS,
  selectDelivered,
  type DeliveredFilters,
  type DeliveredItem,
  type DeliveredMapResponse,
  type DeliveredRow,
} from "@/lib/delivered-map";

type Db = ReturnType<typeof createAdminClient>;

/** PostgREST corta cada respuesta en 1000 filas: se recorre por páginas para que el total sea real. */
const PAGE_SIZE = 1000;
const MAX_PAGES = 12;
const CLIENT_BATCH = 200;
const DAY_MS = 86_400_000;
const COLUMNS =
  "id, client_id, customer_name, status, channel, fudo_sale_type, fudo_source, delivery_address, delivery_lat, delivery_lng, delivered_lat, delivered_lng, courier_name, created_at, ready_at, picked_up_at, delivered_at";

/** Columna ausente es lo mismo que null: sin esto, un punto `undefined` llega a Leaflet como NaN. */
function normalizeRow(r: Partial<DeliveredRow> & Pick<DeliveredRow, "id" | "status" | "created_at">): DeliveredRow {
  return {
    id: r.id,
    status: r.status,
    created_at: r.created_at,
    client_id: r.client_id ?? null,
    customer_name: r.customer_name ?? null,
    channel: r.channel ?? null,
    fudo_sale_type: r.fudo_sale_type ?? null,
    fudo_source: r.fudo_source ?? null,
    delivery_address: r.delivery_address ?? null,
    delivery_lat: r.delivery_lat ?? null,
    delivery_lng: r.delivery_lng ?? null,
    delivered_lat: r.delivered_lat ?? null,
    delivered_lng: r.delivered_lng ?? null,
    courier_name: r.courier_name ?? null,
    ready_at: r.ready_at ?? null,
    picked_up_at: r.picked_up_at ?? null,
    delivered_at: r.delivered_at ?? null,
  };
}

/**
 * Filas candidatas por fecha de creación: un día antes del rango, porque la entrega puede caer después de la medianoche.
 * Se pide por separado delivery de Fudo y pedidos sin tipo (web, WhatsApp): el take away es la mayoría de las ventas
 * y filtrarlo en la base evita traer miles de filas que el Worker después descarta.
 */
async function readRows(db: Db, filters: DeliveredFilters): Promise<{ rows: DeliveredRow[]; truncated: boolean }> {
  const [delivery, untyped] = await Promise.all([readScope(db, filters, "delivery"), readScope(db, filters, "untyped")]);
  return { rows: [...delivery.rows, ...untyped.rows], truncated: delivery.truncated || untyped.truncated };
}

async function readScope(db: Db, filters: DeliveredFilters, scope: "delivery" | "untyped"): Promise<{ rows: DeliveredRow[]; truncated: boolean }> {
  const since = new Date(new Date(filters.from).getTime() - DAY_MS).toISOString();
  const rows: DeliveredRow[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const base = db.from("orders").select(COLUMNS).eq("status", "Finalizados");
    const typed = scope === "delivery" ? base.eq("fudo_sale_type", "DELIVERY") : base.is("fudo_sale_type", null);
    const { data, error } = await typed
      .gte("created_at", since)
      .lt("created_at", filters.to)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const batch = ((data ?? []) as unknown as Array<Partial<DeliveredRow> & Pick<DeliveredRow, "id" | "status" | "created_at">>).map(normalizeRow);
    rows.push(...batch);
    if (batch.length < PAGE_SIZE) return { rows, truncated: false };
  }
  return { rows, truncated: true };
}

async function clientNames(db: Db, ids: readonly string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CLIENT_BATCH) {
    const { data, error } = await db.from("clients").select("id, name").in("id", ids.slice(i, i + CLIENT_BATCH));
    if (error) throw new Error(error.message);
    for (const c of data ?? []) names.set(c.id, c.name);
  }
  return names;
}

export async function loadDeliveredMap(db: Db, filters: DeliveredFilters): Promise<DeliveredMapResponse> {
  const { rows, truncated } = await readRows(db, filters);
  const selection = selectDelivered(rows, filters);
  const markerRows = selection.rows.filter((o) => deliveredPoint(o) !== null).slice(0, MAX_MARKERS);
  const listRows = selection.rows.slice(0, LIST_LIMIT);
  const ids = [...new Set([...markerRows, ...listRows].map((o) => o.client_id).filter((id): id is string => Boolean(id)))];
  const names = await clientNames(db, ids);

  const toItem = ({ client_id, customer_name, ...rest }: DeliveredRow): DeliveredItem => ({
    ...rest,
    client_name: (client_id ? names.get(client_id) : undefined) ?? customer_name?.trim() ?? "Mostrador",
  });
  return { summary: selection.summary, couriers: selection.couriers, channels: selection.channels, markers: markerRows.map(toItem), list: listRows.map(toItem), truncated };
}
