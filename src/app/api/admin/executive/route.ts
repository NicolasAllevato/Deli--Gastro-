import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { readConfig } from "@/lib/orders-server";
import { listZones } from "@/lib/zones-server";
import { buildExecutiveSnapshot, previousBounds, type ExecutiveOrder } from "@/lib/reports/executive";
import {
  buildZoneResolver,
  fetchByCursor,
  toReviewInputs,
  type CursorPage,
  type OrderCoords,
  type PageCursor,
  type ReviewRow,
} from "@/lib/reports/executiveZones";
import { EXECUTIVE_SETTINGS_KEY, ZONE_ID_PATTERN, settingsFromStored } from "@/lib/reports/executiveSettings";
import { RANGE_KEYS, rangeBounds, type Bounds, type RangeKey } from "@/lib/reports/range";

type Db = ReturnType<typeof createAdminClient>;

const NO_STORE = { "Cache-Control": "no-store" } as const;
const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

const rangeSchema = z.enum(RANGE_KEYS as [RangeKey, ...RangeKey[]]);
const zoneSchema = z.string().trim().regex(ZONE_ID_PATTERN);

const ORDER_COLUMNS =
  "id, status, total, channel, fudo_source, fudo_sale_type, created_at, ready_at, delivered_at, delivery_lat, delivery_lng";

type OrderRow = ExecutiveOrder & OrderCoords;

const fail = (error: string, status: number) =>
  NextResponse.json({ error }, { status, headers: NO_STORE });

/** Filtro de cursor (created_at, id) descendente: filas estrictamente después de `cursor`. */
const cursorFilter = (c: PageCursor) =>
  `created_at.lt."${c.created_at}",and(created_at.eq."${c.created_at}",id.lt."${c.id}")`;

/** Pedidos del período anterior y el actual (con coordenadas de entrega), acotados por fecha. */
function loadOrders(db: Db, from: string, to: string) {
  return fetchByCursor<OrderRow>((cursor) => {
    let query = db.from("orders").select(ORDER_COLUMNS).gte("created_at", from).lt("created_at", to);
    if (cursor) query = query.or(cursorFilter(cursor));
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE) as unknown as PromiseLike<CursorPage<OrderRow>>;
  }, PAGE_SIZE, MAX_PAGES);
}

function loadReviews(db: Db, from: string, to: string) {
  return fetchByCursor<ReviewRow & { id: string }>((cursor) => {
    let query = db.from("reviews").select("id, order_id, rating, feedback, created_at").gte("created_at", from).lt("created_at", to);
    if (cursor) query = query.or(cursorFilter(cursor));
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE) as unknown as PromiseLike<CursorPage<ReviewRow & { id: string }>>;
  }, PAGE_SIZE, MAX_PAGES);
}

function resolveRange(raw: string | null, fallback: RangeKey): RangeKey | null {
  if (raw === null || raw === "") return fallback;
  const parsed = rangeSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Snapshot del tablero ejecutivo: KPIs, tendencias, zonas, canales, reclamos e insights. */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;

  const params = req.nextUrl.searchParams;
  const zoneParam = params.get("zone");
  const zone = zoneParam === null || zoneParam === "" ? null : zoneSchema.safeParse(zoneParam);
  if (zone !== null && !zone.success) return fail("Zona inválida.", 400);

  try {
    const db = createAdminClient();
    const config = await readConfig(db);
    const settings = settingsFromStored(config[EXECUTIVE_SETTINGS_KEY]);
    const range = resolveRange(params.get("range"), settings.defaultRange);
    if (!range) return fail("Período inválido.", 400);

    const bounds: Bounds = rangeBounds(range);
    const since = previousBounds(bounds).from;
    const [ordersRes, zones, reviewsRes] = await Promise.all([
      loadOrders(db, since, bounds.to),
      listZones(db),
      loadReviews(db, since, bounds.to),
    ]);
    // Las filas son recién leídas y locales: se normaliza `total` (numeric llega como texto) sin copiarlas.
    for (const row of ordersRes.rows) row.total = Number(row.total);
    const { zoneOf, zoneNames } = buildZoneResolver(ordersRes.rows, zones);

    const snapshot = buildExecutiveSnapshot({
      orders: ordersRes.rows,
      reviews: toReviewInputs(reviewsRes.rows),
      bounds,
      settings,
      zoneOf,
      rangeKey: range,
      zone: zone?.data ?? null,
      zoneNames,
      truncated: ordersRes.truncated || reviewsRes.truncated,
    });
    return NextResponse.json(snapshot, { headers: NO_STORE });
  } catch {
    return fail("No se pudo armar el tablero ejecutivo.", 500);
  }
}
