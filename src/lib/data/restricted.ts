import { requireStaff, type Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

/**
 * G11: tablas que en Supabase tenían RLS sin políticas (solo service-role).
 * En D1 solo se leen con actor admin/system. Las escrituras específicas de
 * cada una se agregan en su repositorio durante la fase 2, siempre con
 * requireStaff al inicio.
 */
export const STAFF_ONLY_TABLES = [
  "payment_intents",
  "legal_acceptances",
  "couriers",
  "courier_locations",
  "courier_shifts",
  "delivery_zones",
  "order_events",
  "wa_conversations",
  "wa_messages",
  "wa_campaigns",
  "fudo_product_map",
  "fudo_payment_map",
  "fudo_sync_runs",
  "fudo_modifier_groups",
  "fudo_modifier_options",
  "fudo_product_groups",
  "reports_daily",
] as const;
export type StaffOnlyTable = (typeof STAFF_ONLY_TABLES)[number];

/** Lectura genérica paginada para el panel admin. La tabla sale de la lista blanca. */
export async function listStaffTable(db: SqlDatabase, actor: Actor, table: StaffOnlyTable, limit = 100) {
  requireStaff(actor);
  if (!(STAFF_ONLY_TABLES as readonly string[]).includes(table)) throw new Error("Tabla no permitida");
  return (await db.prepare(`SELECT * FROM ${table} LIMIT ?`).bind(Math.min(Math.max(limit, 1), 500)).all()).results;
}
