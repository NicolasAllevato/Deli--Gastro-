/**
 * reports_daily en D1: upsert por fecha (lo que hoy hace finanzas-sync contra
 * PostgREST). Solo staff/sistema. Monto en pesos hacia afuera, centavos en D1.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { assertCents, toCents } from "./money.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export interface DailyReportInput {
  report_date: string;
  total_income: number;
  total_orders: number;
  orders_cancelled: number;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function upsertDailyReport(db: SqlDatabase, actor: Actor, r: DailyReportInput): Promise<void> {
  requireStaff(actor);
  if (!DATE_RE.test(r.report_date)) throw new Error("report_date inválida (YYYY-MM-DD)");
  for (const n of [r.total_orders, r.orders_cancelled]) {
    if (!Number.isInteger(n) || n < 0) throw new Error("conteo inválido");
  }
  await db
    .prepare(
      `INSERT INTO reports_daily (id, report_date, total_income_cents, total_orders, orders_cancelled, generated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(report_date) DO UPDATE SET total_income_cents = excluded.total_income_cents,
         total_orders = excluded.total_orders, orders_cancelled = excluded.orders_cancelled, generated_at = excluded.generated_at`,
    )
    .bind(crypto.randomUUID(), r.report_date, assertCents(toCents(r.total_income), "total_income"), r.total_orders, r.orders_cancelled, nowIso())
    .run();
}
