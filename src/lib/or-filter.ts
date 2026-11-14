/**
 * Subconjunto del filtro `.or()` de PostgREST que usa la app (cursor del tablero ejecutivo):
 *   created_at.lt."2026-…",and(created_at.eq."2026-…",id.lt."uuid")
 * Condiciones `columna.op.valor` (valor opcionalmente entre comillas dobles) unidas por comas
 * (OR) y grupos `and(...)`. Operadores: eq, neq, gt, gte, lt, lte, is.
 */
export type OrOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "is";

export type OrNode =
  | { kind: "cond"; column: string; op: OrOp; value: string | null }
  | { kind: "and" | "or"; items: OrNode[] };

const OPS = new Set<OrOp>(["eq", "neq", "gt", "gte", "lt", "lte", "is"]);

function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let cur = "";
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (!quoted && ch === "(") depth++;
    if (!quoted && ch === ")") depth--;
    if (!quoted && depth === 0 && ch === ",") {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (depth !== 0 || quoted) throw new Error("filtro or() mal formado");
  out.push(cur);
  return out.map((p) => p.trim()).filter(Boolean);
}

function parseItem(item: string): OrNode {
  const group = /^(and|or)\(([\s\S]*)\)$/.exec(item);
  if (group) return { kind: group[1] as "and" | "or", items: splitTop(group[2]).map(parseItem) };
  const m = /^([a-z_][a-z0-9_]*)\.([a-z]+)\.([\s\S]*)$/.exec(item);
  if (!m || !OPS.has(m[2] as OrOp)) throw new Error("filtro or() no soportado");
  let raw = m[3];
  if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
  return { kind: "cond", column: m[1], op: m[2] as OrOp, value: m[2] === "is" && raw === "null" ? null : raw };
}

export function parseOrFilter(expr: string): OrNode {
  return { kind: "or", items: splitTop(expr).map(parseItem) };
}

/** Columnas que usa el filtro (para validarlas contra la lista blanca). */
export function orColumns(node: OrNode): string[] {
  return node.kind === "cond" ? [node.column] : node.items.flatMap(orColumns);
}
