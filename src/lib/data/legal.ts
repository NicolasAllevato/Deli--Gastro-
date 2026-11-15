import { ForbiddenError, type Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

export interface LegalAcceptanceRow {
  document: string;
  version: string;
  accepted_at: string;
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
