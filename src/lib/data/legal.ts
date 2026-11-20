import { ForbiddenError, requireStaff, type Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

export interface LegalAcceptanceRow {
  document: string;
  version: string;
  accepted_at: string;
}

/** Una aceptación con el dato de quién la hizo (listado del panel). */
export interface LegalListRow {
  user_id: string;
  email: string | null;
  role: string | null;
  document: string;
  version: string;
  accepted_at: string;
  ip: string | null;
}

export interface LegalAcceptanceInput {
  id: string;
  document: "terminos" | "privacidad";
  version: string;
  email?: string | null;
  role?: string | null;
  ip?: string | null;
  userAgent?: string | null;
}

/** Cualquier usuario con sesión (cliente, repartidor, admin) acepta y lee solo lo suyo. */
function sessionUserId(actor: Actor): string {
  if (actor.kind === "anon" || actor.kind === "system") throw new ForbiddenError();
  return actor.userId;
}

export async function listOwnLegal(db: SqlDatabase, actor: Actor): Promise<LegalAcceptanceRow[]> {
  const userId = sessionUserId(actor);
  const { results } = await db
    .prepare("SELECT document, version, accepted_at FROM legal_acceptances WHERE user_id = ? ORDER BY accepted_at")
    .bind(userId)
    .all<LegalAcceptanceRow>();
  return results;
}

/**
 * Aceptaciones de todos los usuarios, de la más reciente a la más vieja, para /admin/legal (solo personal). Las constancias que
 * quedaron anonimizadas tras una baja (user_id NULL) no se listan: no son de nadie.
 */
export async function listAllLegal(db: SqlDatabase, actor: Actor, limit = 5000): Promise<LegalListRow[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(
      `SELECT user_id, email, role, document, version, accepted_at, ip FROM legal_acceptances
       WHERE user_id IS NOT NULL ORDER BY accepted_at DESC LIMIT ?`,
    )
    .bind(Math.min(Math.max(Math.trunc(limit), 1), 5000))
    .all<LegalListRow>();
  return results;
}

/** El user_id sale del actor, nunca del cuerpo. Devuelve false si ya estaba aceptado (misma versión). */
export async function acceptOwnLegal(db: SqlDatabase, actor: Actor, input: LegalAcceptanceInput): Promise<boolean> {
  const userId = sessionUserId(actor);
  const r = await db
    .prepare(
      `INSERT INTO legal_acceptances (id, user_id, email, role, document, version, ip, user_agent)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, document, version) DO NOTHING`,
    )
    .bind(input.id, userId, input.email ?? null, input.role ?? null, input.document, input.version, input.ip ?? null, input.userAgent ?? null)
    .run();
  return r.meta.changes === 1;
}

export { acceptOwnLegal as acceptOwn, listOwnLegal as listOwn };
