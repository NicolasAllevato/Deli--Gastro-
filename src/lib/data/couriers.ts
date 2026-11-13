import { ForbiddenError, requireStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

/**
 * G13: el repartidor solo escribe SU ubicación y SU turno. El user_id sale
 * del actor; no hay parámetro courierId que se pueda falsear (sin IDOR).
 */
export async function upsertOwnLocation(
  db: SqlDatabase,
  actor: Actor,
  loc: { courierName: string; lat: number; lng: number; accuracyM?: number | null },
): Promise<void> {
  if (actor.kind !== "repartidor") throw new ForbiddenError();
  await db
    .prepare(
      `INSERT INTO courier_locations (user_id, courier_name, lat, lng, accuracy_m, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET courier_name = excluded.courier_name, lat = excluded.lat, lng = excluded.lng,
         accuracy_m = excluded.accuracy_m, updated_at = excluded.updated_at`,
    )
    .bind(actor.userId, loc.courierName, loc.lat, loc.lng, loc.accuracyM ?? null, nowIso())
    .run();
}

export async function listLocations(db: SqlDatabase, actor: Actor) {
  requireStaff(actor);
  return (await db.prepare("SELECT user_id, courier_name, lat, lng, updated_at FROM courier_locations ORDER BY updated_at DESC").all()).results;
}

export async function requestOwnShift(db: SqlDatabase, actor: Actor, s: { id: string; courierName: string; shiftDay: string }): Promise<void> {
  if (actor.kind !== "repartidor") throw new ForbiddenError();
  await db
    .prepare("INSERT INTO courier_shifts (id, user_id, courier_name, shift_day) VALUES (?, ?, ?, ?) ON CONFLICT (user_id, shift_day) DO NOTHING")
    .bind(s.id, actor.userId, s.courierName, s.shiftDay)
    .run();
}

export async function getOwnShift(db: SqlDatabase, actor: Actor, shiftDay: string) {
  if (actor.kind !== "repartidor") throw new ForbiddenError();
  return db.prepare("SELECT id, status, shift_day FROM courier_shifts WHERE user_id = ? AND shift_day = ?").bind(actor.userId, shiftDay).first();
}

export async function decideShift(db: SqlDatabase, actor: Actor, shiftId: string, status: "approved" | "rejected"): Promise<boolean> {
  requireStaff(actor);
  const r = await db.prepare("UPDATE courier_shifts SET status = ?, decided_at = ? WHERE id = ?").bind(status, nowIso(), shiftId).run();
  return r.meta.changes === 1;
}

/** Datos sensibles del repartidor (pin_hash/pin_encrypted): solo staff y nunca en listados. */
export async function listCouriers(db: SqlDatabase, actor: Actor) {
  requireStaff(actor);
  return (await db.prepare("SELECT user_id, name, active FROM couriers ORDER BY name").all<{ user_id: string; name: string; active: number }>()).results;
}

export async function findCourierByPinHash(db: SqlDatabase, actor: Actor, pinHash: string) {
  requireStaff(actor); // lo llama el login de PIN como `system`
  return db.prepare("SELECT user_id, name FROM couriers WHERE pin_hash = ? AND active = 1").bind(pinHash).first<{ user_id: string; name: string }>();
}
