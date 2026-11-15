/**
 * Reporte diario: agrega los pedidos del día (UTC) en reports_daily.
 * DATA_BACKEND=d1 → solo el binding D1 (montos en centavos); si no, PostgREST de Supabase (legado).
 */
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";

export interface ReportEnv {
  DATA_BACKEND?: string;
  DB?: SqlDatabase;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

interface Totals {
  totalOrders: number;
  ordersCancelled: number;
  /** En la unidad de la fuente (centavos en D1, pesos en Supabase). */
  income: number;
}

const CANCELLED = "Cancelado";

export function isD1(env: ReportEnv): boolean {
  return env.DATA_BACKEND?.trim().toLowerCase() === "d1";
}

function dayRange(now: Date): { day: string; start: string; end: string } {
  const day = now.toISOString().slice(0, 10);
  return { day, start: `${day}T00:00:00.000Z`, end: `${day}T23:59:59.999Z` };
}

function totals(rows: Array<{ status: string; amount: number | string | null }>): Totals {
  const live = rows.filter((r) => r.status !== CANCELLED);
  return {
    totalOrders: rows.length,
    ordersCancelled: rows.length - live.length,
    income: live.reduce((sum, r) => sum + Number(r.amount ?? 0), 0),
  };
}

async function syncD1(db: SqlDatabase, now: Date): Promise<void> {
  const { day, start, end } = dayRange(now);
  const { results } = await db
    .prepare("SELECT status, total_cents AS amount FROM orders WHERE created_at >= ? AND created_at <= ?")
    .bind(start, end)
    .all<{ status: string; amount: number }>();
  const t = totals(results);
  await db
    .prepare(
      `INSERT INTO reports_daily (id, report_date, total_income_cents, total_orders, orders_cancelled, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (report_date) DO UPDATE SET total_income_cents = excluded.total_income_cents,
         total_orders = excluded.total_orders, orders_cancelled = excluded.orders_cancelled, generated_at = excluded.generated_at`,
    )
    .bind(crypto.randomUUID(), day, Math.round(t.income), t.totalOrders, t.ordersCancelled, now.toISOString())
    .run();
}

async function syncSupabase(env: ReportEnv, now: Date): Promise<void> {
  const url = (env.SUPABASE_URL ?? "").trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) throw new Error("faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  const { day, start, end } = dayRange(now);
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  const ordersRes = await fetch(`${url}/rest/v1/orders?select=total,status,created_at&created_at=gte.${start}&created_at=lte.${end}`, { headers });
  if (!ordersRes.ok) throw new Error(`Error leyendo orders: ${await ordersRes.text()}`);
  const orders = (await ordersRes.json()) as Array<{ total: number; status: string }>;
  const t = totals(orders.map((o) => ({ status: o.status, amount: o.total })));
  // on_conflict=report_date: sin él PostgREST resuelve sobre la PK y la 2da corrida choca con unique(report_date).
  const upsertRes = await fetch(`${url}/rest/v1/reports_daily?on_conflict=report_date`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json", prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({
      report_date: day,
      total_income: t.income,
      total_orders: t.totalOrders,
      orders_cancelled: t.ordersCancelled,
      generated_at: now.toISOString(),
    }),
  });
  if (!upsertRes.ok) throw new Error(`Error escribiendo reports_daily: ${await upsertRes.text()}`);
}

export async function syncDailyReport(env: ReportEnv, now: Date = new Date()): Promise<void> {
  if (isD1(env)) {
    if (!env.DB) throw new Error("DATA_BACKEND=d1 sin binding DB");
    return syncD1(env.DB, now);
  }
  return syncSupabase(env, now);
}
