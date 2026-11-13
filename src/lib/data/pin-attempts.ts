import { requireStaff, type Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

/**
 * G14: rate limit + bloqueo del login por PIN. La clave es ip/dispositivo
 * (nunca el PIN). Tras MAX_FAILURES en WINDOW_MS se bloquea LOCK_MS.
 */
export const PIN_MAX_FAILURES = 5;
export const PIN_WINDOW_MS = 15 * 60_000;
export const PIN_LOCK_MS = 30 * 60_000;

/**
 * Tope global: el PIN identifica a la persona, así que rotar IPs esquivaría
 * el bloqueo por clave. Con GLOBAL_MAX fallos en la ventana se frena el login
 * por PIN para todos (alerta operativa) hasta que pase el bloqueo.
 */
export const PIN_GLOBAL_KEY = "__global__";
export const PIN_GLOBAL_MAX = 50;

export async function isPinLocked(db: SqlDatabase, actor: Actor, key: string, now = new Date()): Promise<boolean> {
  requireStaff(actor);
  if (key === PIN_GLOBAL_KEY) throw new Error("Clave reservada");
  const row = await db
    .prepare("SELECT max(locked_until) AS locked_until FROM courier_pin_attempts WHERE key IN (?, ?)")
    .bind(key, PIN_GLOBAL_KEY)
    .first<{ locked_until: string | null }>();
  return !!row?.locked_until && row.locked_until > now.toISOString();
}

/** Registra un fallo de forma atómica (UPSERT por clave y global) y devuelve si quedó bloqueado. */
export async function recordPinFailure(db: SqlDatabase, actor: Actor, key: string, now = new Date()): Promise<boolean> {
  requireStaff(actor);
  if (key === PIN_GLOBAL_KEY) throw new Error("Clave reservada");
  await db.batch([failureStatement(db, key, PIN_MAX_FAILURES, now), failureStatement(db, PIN_GLOBAL_KEY, PIN_GLOBAL_MAX, now)]);
  return isPinLocked(db, actor, key, now);
}

function failureStatement(db: SqlDatabase, key: string, max: number, now: Date) {
  const nowIso = now.toISOString();
  const windowStart = new Date(now.getTime() - PIN_WINDOW_MS).toISOString();
  const lockUntil = new Date(now.getTime() + PIN_LOCK_MS).toISOString();
  return db
    .prepare(
      `INSERT INTO courier_pin_attempts (key, failures, window_start) VALUES (?, 1, ?)
       ON CONFLICT (key) DO UPDATE SET
         failures     = CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END,
         window_start = CASE WHEN window_start < ? THEN ? ELSE window_start END,
         locked_until = CASE WHEN (CASE WHEN window_start < ? THEN 1 ELSE failures + 1 END) >= ? THEN ? ELSE locked_until END`,
    )
    .bind(key, nowIso, windowStart, windowStart, nowIso, windowStart, max, lockUntil);
}

export async function clearPinFailures(db: SqlDatabase, actor: Actor, key: string): Promise<void> {
  requireStaff(actor);
  await db.prepare("DELETE FROM courier_pin_attempts WHERE key = ?").bind(key).run();
}
