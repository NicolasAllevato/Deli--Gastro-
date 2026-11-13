import { ForbiddenError, isStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export interface ClientRow {
  id: string;
  user_id: string | null;
  name: string;
  phone: string | null;
  address: string | null;
  email: string | null;
  tier: string;
  total_points: number;
  wa_marketing_opt_in: number;
}

const COLS = "id, user_id, name, phone, address, email, tier, total_points, wa_marketing_opt_in";

/** client_id del usuario de la sesión (reemplaza `clients.user_id = auth.uid()`). */
export async function ownClientId(db: SqlDatabase, userId: string): Promise<string | null> {
  const row = await db.prepare("SELECT id FROM clients WHERE user_id = ?").bind(userId).first<{ id: string }>();
  return row?.id ?? null;
}

/** G1: el cliente ve solo su fila; staff ve cualquiera. */
export async function getClient(db: SqlDatabase, actor: Actor, clientId: string): Promise<ClientRow | null> {
  if (isStaff(actor)) {
    return db.prepare(`SELECT ${COLS} FROM clients WHERE id = ?`).bind(clientId).first<ClientRow>();
  }
  if (actor.kind !== "cliente") throw new ForbiddenError();
  return db
    .prepare(`SELECT ${COLS} FROM clients WHERE id = ? AND user_id = ?`)
    .bind(clientId, actor.userId)
    .first<ClientRow>();
}

export async function getOwnClient(db: SqlDatabase, actor: Actor): Promise<ClientRow | null> {
  if (actor.kind !== "cliente") throw new ForbiddenError();
  return db.prepare(`SELECT ${COLS} FROM clients WHERE user_id = ?`).bind(actor.userId).first<ClientRow>();
}

export async function listClients(db: SqlDatabase, actor: Actor, limit = 100, offset = 0): Promise<ClientRow[]> {
  if (!isStaff(actor)) throw new ForbiddenError();
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM clients ORDER BY created_at DESC LIMIT ? OFFSET ?`)
    .bind(Math.min(Math.max(limit, 1), 500), Math.max(offset, 0))
    .all<ClientRow>();
  return results;
}

/**
 * G2 (handle_new_user): crea la fila del cliente del usuario de la sesión.
 * El user_id sale del actor, nunca del cuerpo de la petición.
 */
export async function createOwnClient(
  db: SqlDatabase,
  actor: Actor,
  input: { id: string; name: string; phone?: string | null; email?: string | null },
): Promise<void> {
  if (actor.kind !== "cliente") throw new ForbiddenError();
  await db
    .prepare("INSERT INTO clients (id, user_id, name, phone, phone_digits, email) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(input.id, actor.userId, input.name, input.phone ?? null, phoneDigits(input.phone), input.email ?? null)
    .run();
}

/** Columnas que un cliente puede editar de sí mismo (G3 / protect_client_columns). */
export const CLIENT_EDITABLE = ["name", "phone", "address", "email"] as const;
type ClientEditable = (typeof CLIENT_EDITABLE)[number];
/** Admin además puede tocar tier y el opt-in de marketing. Puntos: solo por ledger. */
export const ADMIN_EDITABLE = [...CLIENT_EDITABLE, "tier", "wa_marketing_opt_in"] as const;
type AdminEditable = (typeof ADMIN_EDITABLE)[number];

export async function updateClient(
  db: SqlDatabase,
  actor: Actor,
  clientId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const allowed: readonly string[] = isStaff(actor) ? ADMIN_EDITABLE : CLIENT_EDITABLE;
  if (!isStaff(actor) && actor.kind !== "cliente") throw new ForbiddenError();
  const forbidden = Object.keys(patch).filter((k) => !allowed.includes(k));
  if (forbidden.length > 0) throw new ForbiddenError(`Campos no editables: ${forbidden.join(", ")}`);

  const keys = Object.keys(patch) as (ClientEditable | AdminEditable)[];
  if (keys.length === 0) return false;
  const values = keys.map((k) => normalize(patch[k]));
  // Los nombres de columna salen de la lista blanca de arriba, nunca del input.
  const sets = keys.map((k) => `${k} = ?`);
  if (keys.includes("phone")) {
    sets.push("phone_digits = ?");
    values.push(phoneDigits(patch.phone as string | null));
  }
  sets.push("updated_at = ?");
  values.push(nowIso());

  const where = actor.kind === "cliente" ? "id = ? AND user_id = ?" : "id = ?";
  const params = actor.kind === "cliente" ? [clientId, actor.userId] : [clientId];
  const res = await db.prepare(`UPDATE clients SET ${sets.join(", ")} WHERE ${where}`).bind(...values, ...params).run();
  return res.meta.changes === 1;
}

function normalize(v: unknown): string | number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string" || typeof v === "number") return v;
  throw new Error("Valor inválido");
}

export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits ? digits.slice(-10) : null;
}
