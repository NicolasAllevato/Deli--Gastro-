/**
 * Etapa 4 del corte: versiones por topic (migración D1 0006) en lugar de Supabase Realtime.
 * La versión no trae datos, pero igual se autoriza por topic como los canales de antes:
 * - admin / sistema: todos.
 * - repartidor: 'orders' y 'courier_shifts' (lo que escuchan su pantalla y la habilitación).
 * - cliente: solo 'order:<id>' de un pedido propio.
 * - anon: ninguno.
 * Un topic no permitido o inexistente responde versión 0: no revela si el pedido existe.
 */
import type { Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

export const MAX_TOPICS = 10;
const TOPIC_RE = /^(orders|courier_shifts|wa_conversations|wa_campaigns|order:[0-9a-f-]{36}|wa_conversation:[0-9a-f-]{36})$/;

export function parseTopics(raw: string | null): string[] | null {
  if (!raw) return null;
  const topics = [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))];
  if (topics.length === 0 || topics.length > MAX_TOPICS) return null;
  return topics.every((t) => TOPIC_RE.test(t)) ? topics : null;
}

async function allowedFor(db: SqlDatabase, actor: Actor, topics: string[]): Promise<Set<string>> {
  if (actor.kind === "admin" || actor.kind === "system") return new Set(topics);
  if (actor.kind === "repartidor") return new Set(topics.filter((t) => t === "orders" || t === "courier_shifts"));
  if (actor.kind !== "cliente") return new Set();

  const ids = topics.filter((t) => t.startsWith("order:")).map((t) => t.slice(6));
  if (ids.length === 0) return new Set();
  const { results } = await db
    .prepare(`SELECT o.id FROM orders o JOIN clients c ON c.id = o.client_id WHERE c.user_id = ? AND o.id IN (SELECT value FROM json_each(?))`)
    .bind(actor.userId, JSON.stringify(ids))
    .all<{ id: string }>();
  return new Set(results.map((r) => `order:${r.id}`));
}

/** Versión de cada topic pedido (0 si no está permitido o todavía no tuvo cambios). */
export async function liveVersions(db: SqlDatabase, actor: Actor, topics: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = Object.fromEntries(topics.map((t) => [t, 0]));
  const allowed = [...(await allowedFor(db, actor, topics))];
  if (allowed.length === 0) return out;
  const { results } = await db
    .prepare(`SELECT topic, version FROM live_versions WHERE topic IN (SELECT value FROM json_each(?))`)
    .bind(JSON.stringify(allowed))
    .all<{ topic: string; version: number }>();
  for (const r of results) out[r.topic] = Number(r.version);
  return out;
}
