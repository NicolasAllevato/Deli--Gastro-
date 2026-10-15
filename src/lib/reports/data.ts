import { createAdminClient } from "@/utils/supabase/admin";
import type { ReportOrder } from "./analytics.ts";
import type { ExportClient } from "./clientExport.ts";
import { fetchAllExact, PAGE_SIZE, type Page } from "./paginate.ts";

type Db = ReturnType<typeof createAdminClient>;

const MAX_PAGES = 20;

const ORDER_COLUMNS =
  "id, client_id, status, total, delivery_fee, channel, payment_method, items_desc, created_at, accepted_at, ready_at, picked_up_at, delivered_at";

/**
 * Trae todas las filas de a páginas de 1000 (el tope por consulta de Supabase), de la más
 * nueva a la más vieja, usando `created_at` como cursor.
 */
async function fetchAll<Row extends { created_at: string }>(
  page: (before: string | null) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[]> {
  const all: Row[] = [];
  let before: string | null = null;
  for (let i = 0; i < MAX_PAGES; i++) {
    const { data, error } = await page(before);
    // Un informe con datos parciales es peor que uno que falla: se corta y se avisa.
    if (error) throw new Error(`No se pudieron leer los datos del informe: ${error.message}`);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    before = rows[rows.length - 1]!.created_at;
  }
  return all;
}

const CLIENT_COLUMNS = "id, name, phone, address, tier, total_points, wa_marketing_opt_in, created_at";

const asPage = <Row,>(q: unknown) => q as Page<Row>;

/** Clientes con todos sus datos y todos los pedidos, para la exportación. Lanza si no entra todo. */
export async function loadClientExportData(db: Db): Promise<{ clients: ExportClient[]; orders: ReportOrder[] }> {
  const [clients, orders] = await Promise.all([
    fetchAllExact<ExportClient>((upTo) => {
      let query = db.from("clients").select(CLIENT_COLUMNS);
      if (upTo) query = query.lte("created_at", upTo);
      return asPage<ExportClient>(query.order("created_at", { ascending: false }).limit(PAGE_SIZE));
    }),
    fetchAllExact<ReportOrder>((upTo) => {
      let query = db.from("orders").select(ORDER_COLUMNS);
      if (upTo) query = query.lte("created_at", upTo);
      return asPage<ReportOrder>(query.order("created_at", { ascending: false }).limit(PAGE_SIZE));
    }),
  ]);
  return {
    clients,
    orders: orders.map((o) => ({ ...o, total: Number(o.total), delivery_fee: Number(o.delivery_fee) })),
  };
}

export interface ReportData {
  orders: ReportOrder[];
  clients: Array<{ id: string; name: string }>;
  priceByName: Map<string, number>;
  reviews: Array<{ rating: number; created_at: string }>;
}

/** Todo lo que necesitan los informes, leído una sola vez. Solo lectura. */
export async function loadReportData(db: Db): Promise<ReportData> {
  const [orders, clients, reviews, products] = await Promise.all([
    fetchAll((before) => {
      let query = db.from("orders").select(ORDER_COLUMNS);
      if (before) query = query.lt("created_at", before);
      return query.order("created_at", { ascending: false }).limit(PAGE_SIZE) as unknown as PromiseLike<{ data: Array<ReportOrder> | null; error: { message: string } | null }>;
    }),
    fetchAll((before) => {
      let query = db.from("clients").select("id, name, created_at");
      if (before) query = query.lt("created_at", before);
      return query.order("created_at", { ascending: false }).limit(PAGE_SIZE);
    }),
    fetchAll((before) => {
      let query = db.from("reviews").select("rating, created_at");
      if (before) query = query.lt("created_at", before);
      return query.order("created_at", { ascending: false }).limit(PAGE_SIZE);
    }),
    db.from("products").select("name, price"),
  ]);

  return {
    orders: orders.map((o) => ({ ...o, total: Number(o.total), delivery_fee: Number(o.delivery_fee) })),
    clients: clients.map((c) => ({ id: c.id, name: c.name })),
    priceByName: new Map((products.data ?? []).map((p) => [p.name, Number(p.price)])),
    reviews,
  };
}
