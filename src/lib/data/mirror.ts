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
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "number" || typeof v === "string") return v;
  return JSON.stringify(v);
}

export function upsertStatement(db: SqlDatabase, table: string, key: string[], cols: string[], values: SqlValue[]) {
  const updates = cols.filter((c) => !key.includes(c)).map((c) => `${c} = excluded.${c}`);
  // table, key y cols salen de listas blancas de este archivo, nunca del input.
  const onConflict = updates.length > 0 ? `DO UPDATE SET ${updates.join(", ")}` : "DO NOTHING";
  const sql = `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")}) ON CONFLICT (${key.join(", ")}) ${onConflict}`;
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

/**
 * Tablas que escriben los Workers (fudo-gateway, whatsapp-bot) y su forma en D1.
 * `cols`: columnas permitidas con su nombre en Supabase; `money`: pesos → centavos;
 * `key`: columna(s) de conflicto. Lo que no esté acá no se copia.
 */
interface TableSpec {
  key: string[];
  cols: readonly string[];
  money?: Record<string, string>;
}

export const WORKER_TABLES: Record<string, TableSpec> = {
  categories: {
    key: ["id"],
    cols: ["id", "name", "description", "is_active", "created_at", "updated_at", "points_per_100", "fudo_id", "source", "fudo_synced_at"],
  },
  products: {
    key: ["id"],
    cols: ["id", "category_id", "name", "description", "price", "image_url", "is_active", "created_at", "updated_at", "points_per_100", "fudo_id", "source", "fudo_synced_at"],
    money: { price: "price_cents" },
  },
  fudo_product_map: { key: ["product_id"], cols: ["product_id", "fudo_product_id", "fudo_name", "updated_at"] },
  fudo_sync_runs: {
    key: ["id"],
    cols: ["id", "ran_at", "ok", "categories_created", "categories_updated", "products_created", "products_updated", "products_deactivated", "error", "kind"],
  },
  order_items: {
    key: ["id"],
    cols: ["id", "order_id", "product_id", "name", "qty", "unit_price", "created_at", "fudo_product_id", "fudo_comment", "fudo_options", "is_combo"],
    money: { unit_price: "unit_price_cents" },
  },
  order_events: { key: ["id"], cols: ["id", "order_id", "event", "actor", "detail", "created_at"] },
  clients: {
    key: ["id"],
    cols: ["id", "user_id", "name", "phone", "address", "tier", "total_points", "created_at", "updated_at", "wa_marketing_opt_in", "fudo_customer_id", "email", "source", "channel", "is_anonymous"],
  },
  wa_conversations: {
    key: ["id"],
    cols: ["id", "client_phone", "client_id", "contact_name", "state", "human_takeover", "last_inbound_at", "created_at", "updated_at", "bot_paused_until"],
  },
  wa_messages: { key: ["id"], cols: ["id", "conversation_id", "wamid", "direction", "type", "body", "status", "tokens", "created_at"] },
};

/**
 * Copia filas (como las devuelve Supabase) de una tabla de WORKER_TABLES a D1, en un batch.
 * `orders` usa mirrorOrderRow (dueño del pedido, 37 columnas). clients: phone_digits se recalcula.
 */
export async function mirrorRows(db: SqlDatabase, actor: Actor, table: string, rows: Row[]): Promise<void> {
  requireStaff(actor);
  if (rows.length === 0) return;
  if (table === "orders") {
    for (const row of rows) await mirrorOrderRow(db, actor, row);
    return;
  }
  const spec = Object.prototype.hasOwnProperty.call(WORKER_TABLES, table) ? WORKER_TABLES[table] : undefined;
  if (!spec) throw new Error(`mirror: tabla no permitida ${table}`);
  const statements = rows.map((row) => {
    if (spec.key.some((k) => row[k] === undefined || row[k] === null)) throw new Error(`mirror: fila de ${table} sin clave`);
    const present = spec.cols.filter((c) => c in row);
    const cols = present.map((c) => spec.money?.[c] ?? c);
    const values = present.map((c) => (spec.money?.[c] ? toCents((row[c] as number | string | null) ?? 0) : sqlValue(row[c])));
    if (table === "clients" && "phone" in row) {
      const digits = String(row.phone ?? "").replace(/\D/g, "");
      cols.push("phone_digits");
      values.push(digits ? digits.slice(-10) : null);
    }
    return upsertStatement(db, table, spec.key, cols, values);
  });
  await db.batch(statements);
}
