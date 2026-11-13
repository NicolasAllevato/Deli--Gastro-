import { getCloudflareContext } from "@opennextjs/cloudflare";
import { usesD1 } from "./backend.ts";
import type { SqlDatabase } from "./sql.ts";

/**
 * ÚNICO punto del código que toca el binding D1 (`env.DB`). Prohibido fuera
 * de src/lib/data por ESLint (no-restricted-imports) y por
 * tests/data-guard.test.ts. Con DATA_BACKEND=supabase (default) lanza: así un
 * import accidental no cambia el comportamiento de producción.
 */
export async function getDb(): Promise<SqlDatabase> {
  if (!usesD1()) throw new Error("D1 desactivado (DATA_BACKEND=supabase)");
  const { env } = await getCloudflareContext({ async: true });
  const db = (env as unknown as { DB?: SqlDatabase }).DB;
  if (!db) throw new Error("Binding D1 'DB' no configurado");
  return db;
}
