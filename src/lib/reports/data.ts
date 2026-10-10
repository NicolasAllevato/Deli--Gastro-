import { createAdminClient } from "@/utils/supabase/admin";
import type { ReportOrder } from "./analytics.ts";

type Db = ReturnType<typeof createAdminClient>;

const PAGE_SIZE = 1000;
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
