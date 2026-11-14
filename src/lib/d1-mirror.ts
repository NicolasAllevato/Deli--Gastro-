import type { createAdminClient } from "@/utils/supabase/admin";
import { dataFor, mirrorToD1, systemActor, type SupabaseAuthUser } from "@/lib/data";

/**
 * Atajos para reflejar en D1 (modo dual) lo que las rutas de pedidos y
 * repartidores ya escribieron en Supabase. Con DATA_BACKEND=supabase no hacen
 * nada; un fallo de D1 nunca rompe la petición (ver mirrorToD1).
 */
type Db = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;

const api = (op: string) => dataFor(systemActor(`mirror:${op}`));

export const mirrorOrder = (op: string, row: Row) => mirrorToD1(op, async () => (await api(op)).mirror.order(row));

export const mirrorOrderEvents = (op: string, rows: Row[]) =>
  mirrorToD1(op, async () => (await api(op)).mirror.orderEvents(rows));

/** Relee la fila completa del repartidor en Supabase (incluye pin_hash/pin_encrypted) y la copia. */
export const mirrorCourier = (op: string, db: Db, userId: string) =>
  mirrorToD1(op, async () => {
    const { data, error } = await db.from("couriers").select("*").eq("user_id", userId).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) await (await api(op)).mirror.courier(data as Row);
  });

export const mirrorShift = (op: string, row: Row) => mirrorToD1(op, async () => (await api(op)).mirror.shift(row));

export const mirrorLocation = (op: string, row: Row) => mirrorToD1(op, async () => (await api(op)).mirror.location(row));

export const mirrorLocationDelete = (op: string, userId: string) =>
  mirrorToD1(op, async () => (await api(op)).mirror.locationDelete(userId));

/** Copia filas ya devueltas por Supabase de una tabla permitida (ver WORKER_TABLES en la capa). */
export const mirrorTableRows = (op: string, table: string, rows: Row[]) =>
  mirrorToD1(op, async () => (await api(op)).mirror.rows(table, rows));

/** Relee una fila por id en Supabase y la copia (para updates que no devuelven la fila). */
export const mirrorRowById = (op: string, db: Db, table: "payment_intents" | "clients" | "points_ledger", id: string) =>
  mirrorToD1(op, async () => {
    const { data, error } = await db.from(table).select("*").eq("id", id).maybeSingle();
    if (error) throw new Error(error.message);
    if (data) await (await api(op)).mirror.rows(table, [data as Row]);
  });

/** Usuario de Supabase Auth → "user" de D1 (rol solo de app_metadata, sin contraseña). */
export const mirrorAuthUser = (op: string, user: SupabaseAuthUser) =>
  mirrorToD1(op, async () => (await api(op)).mirror.authUsers([user]));
