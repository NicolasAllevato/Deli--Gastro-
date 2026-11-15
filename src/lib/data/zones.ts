/**
 * Zonas de delivery en D1 (ABM del admin). Solo staff. La API habla en pesos;
 * en D1 son centavos (fee_cents, min_order_cents) y la forma es JSON texto.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { assertCents, fromCents, toCents } from "./money.ts";
import { nowIso, type SqlDatabase, type SqlValue } from "./sql.ts";

export interface ZoneDbRow {
  id: string;
  name: string;
  shape: string;
  fee_cents: number;
  min_order_cents: number;
  sort_order: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ApiZone {
  id: string;
  name: string;
  shape: unknown;
  fee: number;
  min_order: number;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface ZoneWriteInput {
  name: string;
  shape: unknown;
  fee: number;
  min_order: number;
  sort_order?: number;
  is_active?: boolean;
}

const COLS = "id, name, shape, fee_cents, min_order_cents, sort_order, is_active, created_at, updated_at";

function toApi(r: ZoneDbRow): ApiZone {
  return {
    id: r.id, name: r.name, shape: JSON.parse(r.shape) as unknown, fee: fromCents(r.fee_cents),
    min_order: fromCents(r.min_order_cents), sort_order: r.sort_order, is_active: r.is_active === 1,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

async function getZone(db: SqlDatabase, id: string): Promise<ApiZone | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM delivery_zones WHERE id = ?`).bind(id).first<ZoneDbRow>();
  return row ? toApi(row) : null;
}

export async function listAllZones(db: SqlDatabase, actor: Actor): Promise<ApiZone[]> {
  requireStaff(actor);
  const { results } = await db.prepare(`SELECT ${COLS} FROM delivery_zones ORDER BY sort_order ASC`).all<ZoneDbRow>();
  return results.map(toApi);
}

export async function createZone(db: SqlDatabase, actor: Actor, id: string, z: ZoneWriteInput): Promise<ApiZone> {
  requireStaff(actor);
  await db
    .prepare("INSERT INTO delivery_zones (id, name, shape, fee_cents, min_order_cents, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(
      id, z.name, JSON.stringify(z.shape), assertCents(toCents(z.fee), "fee"), assertCents(toCents(z.min_order), "min_order"),
      z.sort_order ?? 0, z.is_active === false ? 0 : 1,
    )
    .run();
  const row = await getZone(db, id);
  if (!row) throw new Error("Zona no creada");
  return row;
}

/** Lista blanca: campo de la API → columna D1. */
const EDITABLE: Record<string, string> = {
  name: "name", shape: "shape", fee: "fee_cents", min_order: "min_order_cents", sort_order: "sort_order", is_active: "is_active",
};

function toColumnValue(k: string, v: unknown): SqlValue {
  if (k === "shape") return JSON.stringify(v);
  if (k === "fee" || k === "min_order") return assertCents(toCents(v as number), k);
  if (k === "is_active") return v ? 1 : 0;
  return v as SqlValue;
}

/** Devuelve null si la zona no existe. */
export async function updateZone(db: SqlDatabase, actor: Actor, id: string, patch: Partial<ZoneWriteInput>): Promise<ApiZone | null> {
  requireStaff(actor);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const unknown = entries.filter(([k]) => !Object.hasOwn(EDITABLE, k)).map(([k]) => k);
  if (unknown.length) throw new Error(`Campos no editables: ${unknown.join(", ")}`);
  if (!(await getZone(db, id))) return null;
  if (entries.length === 0) return getZone(db, id);
  const sets = [...entries.map(([k]) => `${EDITABLE[k]} = ?`), "updated_at = ?"];
  const values = [...entries.map(([k, v]) => toColumnValue(k, v)), nowIso()];
  await db.prepare(`UPDATE delivery_zones SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
  return getZone(db, id);
}

/** Idempotente como en Supabase: true si borró una fila. */
export async function deleteZone(db: SqlDatabase, actor: Actor, id: string): Promise<boolean> {
  requireStaff(actor);
  const r = await db.prepare("DELETE FROM delivery_zones WHERE id = ?").bind(id).run();
  return r.meta.changes === 1;
}
