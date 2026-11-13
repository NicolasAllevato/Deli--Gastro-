import { requireStaff, type Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

/**
 * G14: rate limit + bloqueo del login por PIN. La clave es ip/dispositivo
 * (nunca el PIN). Tras MAX_FAILURES en WINDOW_MS se bloquea LOCK_MS.
 */
export const PIN_MAX_FAILURES = 5;
export const PIN_WINDOW_MS = 15 * 60_000;
export const PIN_LOCK_MS = 30 * 60_000;

export async function isPinLocked(db: SqlDatabase, actor: Actor, key: string, now = new Date()): Promise<boolean> {
  requireStaff(actor);
  const row = await db.prepare("SELECT locked_until FROM courier_pin_attempts WHERE key = ?").bind(key).first<{ locked_until: string | null }>();
  return !!row?.locked_until && row.locked_until > now.toISOString();
}

/** Registra un fallo de forma atómica (un solo UPSERT) y devuelve si quedó bloqueado. */
export async function recordPinFailure(db: SqlDatabase, actor: Actor, key: string, now = new Date()): Promise<boolean> {
  requireStaff(actor);
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - PIN_WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + PIN_LOCK_MS).toISOString();
  await db
    .prepare(
      `INSERT INTO courier_pin_attempts (key, failures, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         failures     = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
         locked_until = CASE WHEN (CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END) >= ? THEN ? ELSE locked_until END`,
    )
    .bind(key, nowIso, windowStart, windowStart, nowIso, windowStart, PIN_MAX_FAILURES, lockUntil)
    .run();
  return isPinLocked(db, actor, key, now);
}

export async function clearPinFailures(db: SqlDatabase, actor: Actor, key: string): Promise<void> {
  requireStaff(actor);
  await db.prepare("DELETE FROM courier_pin_attempts WHERE key = ?").bind(key).run();
}
