/**
 * Tickets de reclamo que deja el bot de WhatsApp fuera de horario (tabla `reclamos`, migración 0014).
 * El Worker los crea; acá el admin los lista y los marca resueltos.
 */
import { z } from "zod";
import { requireStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export interface Reclamo {
  id: string;
  conversation_id: string;
  client_phone: string;
  client_id: string | null;
  client_name: string | null;
  motivo: string;
  estado: "abierto" | "resuelto";
  created_at: string;
  resolved_at: string | null;
}

export const reclamoEstadoSchema = z.object({ id: z.string().min(1).max(64), estado: z.enum(["abierto", "resuelto"]) }).strict();
export type ReclamoEstado = z.infer<typeof reclamoEstadoSchema>;

/** Abiertos primero, después los más nuevos. */
export async function listReclamos(db: SqlDatabase, actor: Actor, limit = 100): Promise<Reclamo[]> {
  requireStaff(actor);
  const lim = Math.min(Math.max(limit, 1), 200);
  const { results } = await db
    .prepare(
      `SELECT r.id, r.conversation_id, r.client_phone, r.client_id, coalesce(c.name, w.contact_name) AS client_name,
              r.motivo, r.estado, r.created_at, r.resolved_at
       FROM reclamos r
       LEFT JOIN clients c ON c.id = r.client_id
       LEFT JOIN wa_conversations w ON w.id = r.conversation_id
       ORDER BY r.estado = 'resuelto', r.created_at DESC LIMIT ?`,
    )
    .bind(lim)
    .all<Reclamo>();
  return results;
}

/** Marca un reclamo abierto o resuelto. false si no existe. */
export async function setReclamoEstado(db: SqlDatabase, actor: Actor, input: ReclamoEstado): Promise<boolean> {
  requireStaff(actor);
  const r = await db
    .prepare("UPDATE reclamos SET estado = ?, resolved_at = ? WHERE id = ?")
    .bind(input.estado, input.estado === "resuelto" ? nowIso() : null, input.id)
    .run();
  return r.meta.changes === 1;
}

export const reclamosApp = {
  list: async (actor: Actor): Promise<Reclamo[]> => listReclamos(await appDb(), actor),
  setEstado: async (actor: Actor, input: ReclamoEstado): Promise<boolean> => setReclamoEstado(await appDb(), actor, input),
};

async function appDb(): Promise<SqlDatabase> {
  const { getDb } = await import("./db.ts");
  return getDb();
}
