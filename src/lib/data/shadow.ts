/**
 * Fase 2: escritura doble y lectura sombra detrás de DATA_BACKEND.
 *
 * - supabase (default): solo corre `primary` (Supabase). D1 no se toca.
 * - dual: Supabase sigue siendo la fuente de verdad. Las lecturas devuelven
 *   Supabase y en paralelo leen D1 para comparar; las escrituras van a
 *   Supabase y después se reflejan en D1. Un fallo en D1 NUNCA rompe la
 *   petición: se registra y se reconcilia con el script de migración.
 * - d1: solo D1 (tras el corte, con OK del usuario).
 *
 * Registro de diferencias SIN PII: nombre de la operación, cantidades,
 * nombres de campos distintos y un hash corto de la clave de la fila.
 * Nunca valores, nombres, teléfonos, direcciones ni emails.
 */
import { dataBackend, type DataBackend } from "./backend.ts";

export interface ShadowDiff {
  op: string;
  primaryCount: number;
  shadowCount: number;
  missingInShadow: string[];
  extraInShadow: string[];
  /** clave hasheada → campos que difieren */
  fieldDiffs: Record<string, string[]>;
}

export type DiffLogger = (event: { kind: "shadow_diff"; diff: ShadowDiff } | { kind: "shadow_error" | "mirror_error"; op: string; error: string }) => void;

const defaultLogger: DiffLogger = (event) => {
  console.warn("[d1-shadow]", JSON.stringify(event));
};

export interface ShadowOptions<T> {
  op: string;
  /** Lleva cada fila a una forma comparable (p. ej. pesos → centavos). */
  normalize: (row: T) => Record<string, unknown>;
  /** Clave estable de la fila (id). Se registra hasheada. */
  key: (row: Record<string, unknown>) => string;
  backend?: DataBackend;
  log?: DiffLogger;
}

/** Lectura con sombra. Siempre devuelve el resultado de la fuente de verdad. */
export async function shadowRead<P, S>(
  primary: () => Promise<P[]>,
  shadow: () => Promise<S[]>,
  opts: ShadowOptions<P> & { normalizeShadow: (row: S) => Record<string, unknown> },
): Promise<P[] | S[]> {
  const backend = opts.backend ?? dataBackend();
  if (backend === "d1") return shadow();
  if (backend === "supabase") return primary();

  const log = opts.log ?? defaultLogger;
  const [p, s] = await Promise.allSettled([primary(), shadow()]);
  if (p.status === "rejected") throw p.reason; // la fuente de verdad manda
  if (s.status === "rejected") {
    log({ kind: "shadow_error", op: opts.op, error: errorName(s.reason) });
    return p.value;
  }
  const diff = await compareRows(opts.op, p.value.map(opts.normalize), s.value.map(opts.normalizeShadow), opts.key);
  if (diff) log({ kind: "shadow_diff", diff });
  return p.value;
}

/** Escritura doble: Supabase primero; D1 como espejo que no rompe la petición. */
export async function dualWrite<R>(
  op: string,
  primary: () => Promise<R>,
  mirror: () => Promise<unknown>,
  opts: { backend?: DataBackend; log?: DiffLogger } = {},
): Promise<R | undefined> {
  const backend = opts.backend ?? dataBackend();
  if (backend === "supabase") return primary();
  if (backend === "d1") {
    await mirror();
    return undefined;
  }
  const result = await primary();
  try {
    await mirror();
  } catch (err) {
    (opts.log ?? defaultLogger)({ kind: "mirror_error", op, error: errorName(err) });
  }
  return result;
}

/** Solo el tipo/código del error: los mensajes de SQL pueden traer valores. */
function errorName(err: unknown): string {
  if (err instanceof Error) {
    const code = /\b(SQLITE_[A-Z_]+|D1_[A-Z_]+|UNIQUE|CHECK|FOREIGN KEY)\b/.exec(err.message)?.[1];
    return code ? `${err.name}:${code}` : err.name;
  }
  return "unknown";
}

export async function compareRows(
  op: string,
  primary: Record<string, unknown>[],
  shadow: Record<string, unknown>[],
  key: (row: Record<string, unknown>) => string,
): Promise<ShadowDiff | null> {
  const safeKey = (r: Record<string, unknown>) => assertIdKey(key(r));
  const pMap = new Map(primary.map((r) => [safeKey(r), r]));
  const sMap = new Map(shadow.map((r) => [safeKey(r), r]));
  const missing: string[] = [];
  const extra: string[] = [];
  const fieldDiffs: Record<string, string[]> = {};
  for (const [k, row] of pMap) {
    const other = sMap.get(k);
    if (!other) {
      missing.push(await hashKey(k));
      continue;
    }
    const fields = Object.keys({ ...row, ...other }).filter((f) => stable(row[f]) !== stable(other[f]));
    if (fields.length) fieldDiffs[await hashKey(k)] = fields.sort();
  }
  for (const k of sMap.keys()) if (!pMap.has(k)) extra.push(await hashKey(k));
  if (!missing.length && !extra.length && !Object.keys(fieldDiffs).length) return null;
  return { op, primaryCount: primary.length, shadowCount: shadow.length, missingInShadow: missing, extraInShadow: extra, fieldDiffs };
}

/**
 * La clave de comparación tiene que ser un id (uuid o clave de config), nunca
 * un dato enumerable (teléfono, email, fudo_customer_id): con SHA-256 y sal
 * fija esos se revertirían por fuerza bruta. Si hiciera falta, usar HMAC con secreto.
 */
export function assertIdKey(k: string): string {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(k);
  const isConfigKey = /^[a-z][a-z0-9_.:-]{0,63}$/.test(k);
  if (!isUuid && !isConfigKey) throw new Error("shadow: la clave debe ser un id, no un dato personal");
  return k;
}

function stable(v: unknown): string {
  if (v === undefined || v === null) return "null";
  if (typeof v === "boolean") return v ? "1" : "0";
  if (typeof v === "object") return JSON.stringify(v, Object.keys(v as object).sort());
  return String(v);
}

/** Hash corto (no reversible a la vista) para ubicar la fila sin exponer su id en claro. */
export async function hashKey(k: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`d1-shadow:${k}`));
  return Array.from(new Uint8Array(buf).slice(0, 6), (b) => b.toString(16).padStart(2, "0")).join("");
}
