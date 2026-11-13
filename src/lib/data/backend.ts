/**
 * Interruptor de backend de datos (fases de la migración a D1).
 * - supabase (default): comportamiento actual, D1 no se usa.
 * - dual: escribe en ambos, lee de Supabase (fase 2, aún no implementada).
 * - d1: D1 es la fuente de verdad (solo tras el corte, con OK del usuario).
 * Cualquier valor desconocido cae en `supabase`: fallar hacia lo seguro.
 */
export type DataBackend = "supabase" | "dual" | "d1";

const VALID: readonly DataBackend[] = ["supabase", "dual", "d1"];

export function dataBackend(env: Record<string, string | undefined> = process.env): DataBackend {
  const raw = env.DATA_BACKEND?.trim().toLowerCase();
  return (VALID as readonly string[]).includes(raw ?? "") ? (raw as DataBackend) : "supabase";
}

export function usesD1(env?: Record<string, string | undefined>): boolean {
  return dataBackend(env) !== "supabase";
}
