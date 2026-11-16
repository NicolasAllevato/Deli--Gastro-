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
  updated_at: string;
}

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

export async function recordSugerencia(db: SqlDatabase, actor: Actor, id: string, s: SugerenciaInput): Promise<void> {
  requireStaff(actor);
  if (!(KB_CATEGORIAS as readonly string[]).includes(s.categoria)) throw new Error("Categoría inválida");
  const tema = clip(s.tema, 120);
  const contenido = clip(s.contenido, 1000);
  if (!tema || !contenido) throw new Error("Sugerencia vacía");
  await db
    .prepare(
      `INSERT INTO kb_sugerencias (id, clave, categoria, tema, contenido, evidencia) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (clave) DO UPDATE SET veces = veces + 1, updated_at = ?`,
    )
    .bind(id, sugerenciaKey(s), s.categoria, tema, contenido, clip(s.evidencia, 2000), nowIso())
    .run();
}

export async function recordError(db: SqlDatabase, actor: Actor, id: string, e: ErrorInput): Promise<void> {
  requireStaff(actor);
  if (!(ERROR_TIPOS as readonly string[]).includes(e.tipo)) throw new Error("Tipo inválido");
  const mensaje = clip(e.mensaje_cliente, 1000);
  const motivo = clip(e.motivo, 500);
  const correccion = clip(e.correccion, 300);
  if (!mensaje || !motivo || !correccion) throw new Error("Error incompleto");
  await db
    .prepare(
      `INSERT INTO kb_errores (id, clave, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (clave) DO UPDATE SET veces = veces + 1, updated_at = ?`,
    )
    .bind(id, errorKey(e), clip(e.escenario, 60) || "otro", e.tipo, mensaje, clip(e.respuesta_mala, 1000), motivo, correccion, nowIso())
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
    .prepare(`SELECT id, estado, categoria, tema, contenido, evidencia, veces, updated_at FROM kb_sugerencias ORDER BY estado = 'pendiente' DESC, veces DESC, updated_at DESC LIMIT 300`)
    .all<KbSugerencia>();
  return results;
}

export async function listErrores(db: SqlDatabase, actor: Actor): Promise<KbError[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(`SELECT id, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, veces, estado, ultima_prueba, updated_at FROM kb_errores ORDER BY estado = 'pendiente' DESC, veces DESC, updated_at DESC LIMIT 300`)
    .all<KbError>();
  return results;
}

/** Errores aprobados: casos de regresión que el simulador repite primero. */
export async function regressionCases(db: SqlDatabase, actor: Actor): Promise<KbError[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(`SELECT id, escenario, tipo, mensaje_cliente, respuesta_mala, motivo, correccion, veces, estado, ultima_prueba, updated_at FROM kb_errores WHERE estado = 'aprobada' ORDER BY veces DESC LIMIT 100`)
    .all<KbError>();
  return results;
}

// --- Decisiones del admin. -----------------------------------------------------------------------------------

export const decisionSchema = z
  .object({
    tipo: z.enum(["sugerencia", "error"]),
    id: z.string().min(1).max(64),
    accion: z.enum(["aprobar", "rechazar", "desactivar"]),
  })
  .strict();
export type Decision = z.infer<typeof decisionSchema>;

/** Aprueba una sugerencia: la copia a kb_negocio (activa) y la marca aprobada. Devuelve false si no estaba pendiente. */
export async function approveSugerencia(db: SqlDatabase, actor: Actor, id: string, newKbId: string): Promise<boolean> {
  requireStaff(actor);
  const row = await db.prepare(`SELECT id, estado, categoria, tema, contenido, evidencia, veces, updated_at FROM kb_sugerencias WHERE id = ?`).bind(id).first<KbSugerencia>();
  if (!row || row.estado !== "pendiente") return false;
  await db.batch([
    db.prepare("INSERT INTO kb_negocio (id, categoria, tema, contenido) VALUES (?, ?, ?, ?)").bind(newKbId, row.categoria, row.tema, row.contenido),
    db.prepare("UPDATE kb_sugerencias SET estado = 'aprobada', updated_at = ? WHERE id = ?").bind(nowIso(), id),
  ]);
  return true;
}

const ERROR_STATE: Record<Decision["accion"], KbError["estado"]> = { aprobar: "aprobada", rechazar: "rechazada", desactivar: "desactivada" };

/** Aplica la decisión. Devuelve false si la fila no existe o la acción no corresponde. */
export async function decide(db: SqlDatabase, actor: Actor, d: Decision, newId: () => string): Promise<boolean> {
  requireStaff(actor);
  if (d.tipo === "sugerencia") {
    if (d.accion === "aprobar") return approveSugerencia(db, actor, d.id, newId());
    if (d.accion === "desactivar") return false;
    const r = await db.prepare("UPDATE kb_sugerencias SET estado = 'rechazada', updated_at = ? WHERE id = ? AND estado = 'pendiente'").bind(nowIso(), d.id).run();
    return r.meta.changes === 1;
  }
  const r = await db.prepare("UPDATE kb_errores SET estado = ?, updated_at = ? WHERE id = ?").bind(ERROR_STATE[d.accion], nowIso(), d.id).run();
  return r.meta.changes === 1;
}
