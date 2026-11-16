/** Anti-replay de las llamadas internas bot→app (tabla D1 `bot_nonces`). */
import type { SqlDatabase } from "./sql.ts";

export const NONCE_TTL_SECONDS = 120;

/**
 * Registra el nonce; true si es la primera vez que se ve (dentro de su vencimiento).
 * Antes borra los vencidos, así la tabla no crece y un nonce viejo no bloquea para siempre.
 */
export async function claimNonce(db: SqlDatabase, nonce: string, nowMs: number, ttlSeconds = NONCE_TTL_SECONDS): Promise<boolean> {
  const nowS = Math.floor(nowMs / 1000);
  await db.prepare("DELETE FROM bot_nonces WHERE expires_at < ?").bind(nowS).run();
  const r = await db.prepare("INSERT INTO bot_nonces (nonce, expires_at) VALUES (?, ?) ON CONFLICT (nonce) DO NOTHING").bind(nonce, nowS + ttlSeconds).run();
  return r.meta.changes === 1;
}

/** Desde la app: binding D1 único. */
export async function claimBotNonce(nonce: string, nowMs: number): Promise<boolean> {
  const { getDb } = await import("./db.ts");
  return claimNonce(await getDb(), nonce, nowMs);
}
