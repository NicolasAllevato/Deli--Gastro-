import { mirrorRows, WORKER_TABLES } from "../../../src/lib/data/mirror.ts";
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";

/**
 * Espejo D1 de las escrituras del gateway (migración Supabase → D1, modo dual).
 * Solo con DATA_BACKEND = "dual" | "d1" y el binding DB configurado; si no, no hace nada.
 * Supabase sigue siendo la fuente de verdad: un fallo de D1 se registra (sin datos) y no
 * cambia el resultado del sync. La copia completa reconcilia lo que falte.
 */
export interface MirrorEnv {
  DATA_BACKEND?: string;
  DB?: SqlDatabase;
}

const SYSTEM = { kind: "system", reason: "fudo-gateway" } as const;
const MIRRORED = new Set(["orders", ...Object.keys(WORKER_TABLES)]);

export function mirrorEnabled(env: MirrorEnv): env is MirrorEnv & { DB: SqlDatabase } {
  const mode = env.DATA_BACKEND?.trim().toLowerCase();
  return (mode === "dual" || mode === "d1") && Boolean(env.DB);
}

/** Tabla de un path de PostgREST ("orders?id=eq.x" → "orders"), si es una de las espejadas. */
export function mirroredTable(path: string): string | null {
  const table = path.split("?")[0].split("/")[0];
  return MIRRORED.has(table) ? table : null;
}

/** Pide a PostgREST que devuelva las filas escritas (hacen falta para copiarlas), sin tocar el resto del Prefer. */
export function withRepresentation(prefer: string | undefined): string {
  const parts = (prefer ?? "").split(",").map((p) => p.trim()).filter((p) => p && !p.startsWith("return="));
  return [...parts, "return=representation"].join(",");
}

export async function mirrorWrite(env: MirrorEnv, table: string, body: unknown): Promise<void> {
  if (!mirrorEnabled(env)) return;
  const rows = Array.isArray(body) ? body : body && typeof body === "object" ? [body] : [];
  try {
    await mirrorRows(env.DB, SYSTEM, table, rows as Record<string, unknown>[]);
  } catch (err) {
    const code = err instanceof Error ? (/\b(UNIQUE|CHECK|FOREIGN KEY|NOT NULL|D1_[A-Z_]+)\b/.exec(err.message)?.[1] ?? err.name) : "unknown";
    console.warn("[d1-mirror]", JSON.stringify({ kind: "mirror_error", op: `fudo-gateway:${table}`, error: code }));
  }
}
