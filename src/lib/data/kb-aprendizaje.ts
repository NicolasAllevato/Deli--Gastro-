/**
 * Aprendizaje del asistente: sugerencias (kb_sugerencias) y errores/lecciones (kb_errores).
 * Todo entra como `pendiente`; solo un admin lo aprueba. Las escrituras del simulador usan un actor `system`.
 */
import { z } from "zod";
import { requireStaff, type Actor } from "./actor.ts";
import { KB_CATEGORIAS, type KbCategoria } from "./kb-negocio.ts";
import { nowIso, type SqlDatabase } from "./sql.ts";

export const ERROR_TIPOS = ["precio_inventado", "no_derivo", "no_entendio", "tono_frio", "no_resolvio", "otro"] as const;
export type ErrorTipo = (typeof ERROR_TIPOS)[number];

/** Tope de lecciones que recibe el bot en el prompt. */
export const MAX_LESSONS = 20;

export interface KbSugerencia {
  id: string;
  estado: "pendiente" | "aprobada" | "rechazada";
  categoria: KbCategoria;
  tema: string;
  contenido: string;
  evidencia: string;
  veces: number;
  origen: KbOrigen;
  updated_at: string;
}

export const KB_ORIGENES = ["simulacion", "conversacion"] as const;
export type KbOrigen = (typeof KB_ORIGENES)[number];

/** Cómo se registra lo aprendido: de dónde viene y cuántas veces apareció en la corrida (dedupe previo). */
export interface RecordOptions {
  origen?: KbOrigen;
  veces?: number;
}

const vecesOf = (o: RecordOptions): number => Math.max(1, Math.min(10_000, Math.trunc(o.veces ?? 1)));
const origenOf = (o: RecordOptions): KbOrigen => (o.origen === "conversacion" ? "conversacion" : "simulacion");

export interface KbError {
  id: string;
  escenario: string;
  tipo: ErrorTipo;
  mensaje_cliente: string;
  respuesta_mala: string;
  motivo: string;
  correccion: string;
  veces: number;
  estado: "pendiente" | "aprobada" | "rechazada" | "desactivada";
  ultima_prueba: "ok" | "falla" | null;
  origen: KbOrigen;
  updated_at: string;
}

export interface SugerenciaInput {
  categoria: KbCategoria;
  tema: string;
  contenido: string;
  evidencia?: string;
}

export interface ErrorInput {
  escenario: string;
  tipo: ErrorTipo;
  mensaje_cliente: string;
  respuesta_mala?: string;
  motivo: string;
  correccion: string;
}

/** Normaliza para deduplicar: minúsculas, sin acentos ni signos, espacios simples. */
export function normalizeKey(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const sugerenciaKey = (s: Pick<SugerenciaInput, "categoria" | "tema">): string => `${s.categoria}:${normalizeKey(s.tema)}`;
export const errorKey = (e: Pick<ErrorInput, "tipo" | "correccion">): string => `${e.tipo}:${normalizeKey(e.correccion).slice(0, 160)}`;

const clip = (s: string | undefined, max: number): string => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max);

// --- Escrituras del simulador (deduplican y suman `veces`). ---------------------------------------------------

export async function recordSugerencia(db: SqlDatabase, actor: Actor, id: string, s: SugerenciaInput, opts: RecordOptions = {}): Promise<void> {
  requireStaff(actor);
  if (!(KB_CATEGORIAS as readonly string[]).includes(s.categoria)) throw new Error("Categoría inválida");
  const tema = clip(s.tema, 120);
  const contenido = clip(s.contenido, 1000);
  if (!tema || !contenido) throw new Error("Sugerencia vacía");
  await db
    .prepare(
      `INSERT INTO kb_sugerencias (id, clave, origen, categoria, tema, contenido, evidencia, veces) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (clave) DO UPDATE SET veces = veces + excluded.veces, updated_at = ?`,
    )
    .bind(id, sugerenciaKey(s), origenOf(opts), s.categoria, tema, contenido, clip(s.evidencia, 2000), vecesOf(opts), nowIso())
    .run();
}

/** Requiere la migración 0013 (columna `origen` en kb_errores). */
export async function recordError(db: SqlDatabase, actor: Actor, id: string, e: ErrorInput, opts: RecordOptions = {}): Promise<void> {
  requireStaff(actor);
  if (!(ERROR_TIPOS as readonly string[]).includes(e.tipo)) throw new Error("Tipo inválido");
  const mensaje = clip(e.mensaje_cliente, 1000);
  const motivo = clip(e.motivo, 500);
  const correccion = clip(e.correccion, 300);
  if (!mensaje || !motivo || !correccion) throw new Error("Error incompleto");
  await db
    .prepare(
      `INSERT INTO kb_errores (id, clave, origen, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, veces) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (clave) DO UPDATE SET veces = veces + excluded.veces, updated_at = ?`,
    )
    .bind(id, errorKey(e), origenOf(opts), clip(e.escenario, 60) || "otro", e.tipo, mensaje, clip(e.respuesta_mala, 1000), motivo, correccion, vecesOf(opts), nowIso())
    .run();
}

/** Resultado de la prueba de regresión de un error aprobado. */
export async function setRegressionResult(db: SqlDatabase, actor: Actor, id: string, ok: boolean): Promise<void> {
  requireStaff(actor);
  await db.prepare("UPDATE kb_errores SET ultima_prueba = ?, updated_at = ? WHERE id = ?").bind(ok ? "ok" : "falla", nowIso(), id).run();
}

// --- Lecturas. -----------------------------------------------------------------------------------------------


export async function listSugerencias(db: SqlDatabase, actor: Actor): Promise<KbSugerencia[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(`SELECT id, estado, categoria, tema, contenido, evidencia, veces, origen, updated_at FROM kb_sugerencias ORDER BY estado = 'pendiente' DESC, veces DESC, updated_at DESC LIMIT 300`)
    .all<KbSugerencia>();
  return results;
}

export async function listErrores(db: SqlDatabase, actor: Actor): Promise<KbError[]> {
  requireStaff(actor);
  const { results } = await db
    // Pendientes primero, después las aprobadas (las que usa el bot) y al final el historial: si hubiera más de 300, el corte cae en el historial.
    .prepare(
      `SELECT id, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, veces, estado, ultima_prueba, origen, updated_at FROM kb_errores
       ORDER BY CASE estado WHEN 'pendiente' THEN 0 WHEN 'aprobada' THEN 1 ELSE 2 END, veces DESC, updated_at DESC LIMIT 300`,
    )
    .all<KbError>();
  return results;
}

/** Errores aprobados: casos de regresión que el simulador repite primero. */
export async function regressionCases(db: SqlDatabase, actor: Actor): Promise<KbError[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(`SELECT id, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, veces, estado, ultima_prueba, origen, updated_at FROM kb_errores WHERE estado = 'aprobada' ORDER BY veces DESC LIMIT 100`)
    .all<KbError>();
  return results;
}

// --- Decisiones del admin. -----------------------------------------------------------------------------------

export const decisionSchema = z
  .object({
    tipo: z.enum(["sugerencia", "error"]),
    id: z.string().min(1).max(64),
    accion: z.enum(["aprobar", "rechazar", "desactivar", "reabrir"]),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;

/** Aprueba una sugerencia: la copia a kb_negocio (activa) y la marca aprobada. Devuelve false si no estaba pendiente. */
export async function approveSugerencia(db: SqlDatabase, actor: Actor, id: string, newKbId: string): Promise<boolean> {
  requireStaff(actor);
  const row = await db.prepare(`SELECT id, estado, categoria, tema, contenido, evidencia, veces, origen, updated_at FROM kb_sugerencias WHERE id = ?`).bind(id).first<KbSugerencia>();
  if (!row || row.estado !== "pendiente") return false;
  await db.batch([
    db.prepare("INSERT INTO kb_negocio (id, categoria, tema, contenido) VALUES (?, ?, ?, ?)").bind(newKbId, row.categoria, row.tema, row.contenido),
    db.prepare("UPDATE kb_sugerencias SET estado = 'aprobada', updated_at = ? WHERE id = ?").bind(nowIso(), id),
  ]);
  return true;
}

/**
 * Transiciones válidas de un error aprendido: la acción solo corre si la fila está en alguno de los estados de origen
 * (un doble clic, o una pantalla vieja, no pisa una decisión ya tomada).
 *  - aprobar: desde pendiente, o desde desactivada (volver a activar la lección);
 *  - rechazar: solo desde pendiente;
 *  - desactivar: solo desde aprobada;
 *  - reabrir: una rechazada o desactivada vuelve a pendiente para decidirla de nuevo.
 */
export const ERROR_TRANSITIONS: Record<Decision["accion"], { to: KbError["estado"]; from: readonly KbError["estado"][] }> = {
  aprobar: { to: "aprobada", from: ["pendiente", "desactivada"] },
  rechazar: { to: "rechazada", from: ["pendiente"] },
  desactivar: { to: "desactivada", from: ["aprobada"] },
  reabrir: { to: "pendiente", from: ["rechazada", "desactivada"] },
};

/** Aplica la decisión. Devuelve false si la fila no existe o la acción no corresponde a su estado actual (la ruta responde 409). */
export async function decide(db: SqlDatabase, actor: Actor, d: Decision, newId: () => string): Promise<boolean> {
  requireStaff(actor);
  if (d.tipo === "sugerencia") {
    if (d.accion === "aprobar") return approveSugerencia(db, actor, d.id, newId());
    // Desactivar y reabrir solo existen para los errores aprendidos.
    if (d.accion !== "rechazar") return false;
    const r = await db.prepare("UPDATE kb_sugerencias SET estado = 'rechazada', updated_at = ? WHERE id = ? AND estado = 'pendiente'").bind(nowIso(), d.id).run();
    return r.meta.changes === 1;
  }
  const { to, from } = ERROR_TRANSITIONS[d.accion];
  // Como mucho dos estados de origen: el segundo se repite si hay uno solo (el SQL no se arma con valores, todo va por bind).
  const r = await db
    .prepare("UPDATE kb_errores SET estado = ?, updated_at = ? WHERE id = ? AND estado IN (?, ?)")
    .bind(to, nowIso(), d.id, from[0]!, from[1] ?? from[0]!)
    .run();
  return r.meta.changes === 1;
}
