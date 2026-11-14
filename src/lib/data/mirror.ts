/**
 * Espejo D1 de escrituras que la app sigue haciendo en Supabase (fase 2, modo dual).
 * Las reglas de negocio (transiciones, asignación, habilitación) ya se aplicaron
 * en la ruta contra Supabase, que es la fuente de verdad: acá solo se copia la
 * fila resultante tal cual, con un actor de sistema (staff), columnas por lista
 * blanca y consultas parametrizadas. Montos a centavos; booleanos a 0/1.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { CLIENT_ORDER_EXCLUDED, CLIENT_ORDER_FIELDS } from "./client-order-fields.ts";
import { toCents } from "./money.ts";
import type { SqlDatabase, SqlValue } from "./sql.ts";

type Row = Record<string, unknown>;

const D1_ONLY = new Set(["courier_user_id", "payment_intent_id"]);
const MONEY: Record<string, string> = { total: "total_cents", delivery_fee: "delivery_fee_cents" };

/** Columnas de orders que vienen de Supabase (las 37), en su nombre de Supabase. */
export const ORDER_MIRROR_COLUMNS: readonly string[] = [...CLIENT_ORDER_FIELDS, ...CLIENT_ORDER_EXCLUDED].filter((c) => !D1_ONLY.has(c));

function sqlValue(v: unknown): SqlValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

function upsertStatement(db: SqlDatabase, table: string, key: string[], cols: string[], values: SqlValue[]) {
  const updates = cols.filter((c) => !key.includes(c)).map((c) => `${c} = excluded.${c}`);
  // table, key y cols salen de listas blancas de este archivo, nunca del input.
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (${key.join(", ")}) DO UPDATE SET ${updates.join(", ")}`;
  return db.prepare(sql).bind(...values);
}

/**
 * Copia la fila completa de un pedido (como la devuelve Supabase) a D1.
 * courier_user_id se deriva del nombre solo si un único repartidor lo tiene.
 */
export async function mirrorOrderRow(db: SqlDatabase, actor: Actor, row: Row): Promise<void> {
  requireStaff(actor);
  if (typeof row.id !== "string") throw new Error("mirror: pedido sin id");
  const present = ORDER_MIRROR_COLUMNS.filter((c) => c in row);
  const cols = present.map((c) => MONEY[c] ?? c);
  const values = present.map((c) => (MONEY[c] ? toCents((row[c] as number | string | null) ?? 0) : sqlValue(row[c])));
  await db.batch([
    upsertStatement(db, "orders", ["id"], cols, values),
    db
      .prepare(
        "UPDATE orders SET courier_user_id = (SELECT c.user_id FROM couriers c WHERE c.name = orders.courier_name) WHERE id = ? AND (SELECT count(*) FROM couriers c WHERE c.name = orders.courier_name) = 1",
      )
      .bind(row.id),
    db.prepare("UPDATE orders SET courier_user_id = NULL WHERE id = ? AND courier_name IS NULL").bind(row.id),
  ]);
}

const EVENT_COLS = ["id", "order_id", "event", "actor", "detail", "created_at"] as const;

/** Bitácora del pedido: inserta los eventos que no estén (idempotente por id). */
export async function mirrorOrderEvents(db: SqlDatabase, actor: Actor, events: Row[]): Promise<void> {
  requireStaff(actor);
  if (events.length === 0) return;
  await db.batch(
    events.map((e) => {
      const cols = EVENT_COLS.filter((c) => c in e);
      return db
        .prepare(`INSERT INTO order_events (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (id) DO NOTHING`)
        .bind(...cols.map((c) => sqlValue(e[c])));
    }),
  );
}

const COURIER_COLS = ["user_id", "name", "pin_hash", "active", "created_at", "updated_at", "pin_encrypted"] as const;

/** Repartidor completo (incluye pin_hash y pin_encrypted: nunca salen de la capa). */
export async function mirrorCourierRow(db: SqlDatabase, actor: Actor, row: Row): Promise<void> {
  requireStaff(actor);
  const cols = COURIER_COLS.filter((c) => c in row);
  await upsertStatement(db, "couriers", ["user_id"], [...cols], cols.map((c) => sqlValue(row[c]))).run();
}

const SHIFT_COLS = ["id", "user_id", "courier_name", "shift_day", "status", "requested_at", "decided_at"] as const;

export async function mirrorShiftRow(db: SqlDatabase, actor: Actor, row: Row): Promise<void> {
  requireStaff(actor);
  const cols = SHIFT_COLS.filter((c) => c in row);
  await upsertStatement(db, "courier_shifts", ["id"], [...cols], cols.map((c) => sqlValue(row[c]))).run();
}

const LOCATION_COLS = ["user_id", "courier_name", "lat", "lng", "accuracy_m", "heading", "speed_mps", "updated_at"] as const;

export async function mirrorLocationRow(db: SqlDatabase, actor: Actor, row: Row): Promise<void> {
  requireStaff(actor);
  const cols = LOCATION_COLS.filter((c) => c in row);
  await upsertStatement(db, "courier_locations", ["user_id"], [...cols], cols.map((c) => sqlValue(row[c]))).run();
}

export async function mirrorLocationDelete(db: SqlDatabase, actor: Actor, userId: string): Promise<void> {
  requireStaff(actor);
  await db.prepare("DELETE FROM courier_locations WHERE user_id = ?").bind(userId).run();
}
