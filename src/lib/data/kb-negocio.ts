/**
 * Base de conocimiento del negocio (tabla D1 `kb_negocio`). Solo staff escribe y lista todo;
 * el bot lee las activas directo en su Worker (workers/whatsapp-bot/src/repo/d1.ts).
 */
import { z } from "zod";
import { requireStaff, type Actor } from "./actor.ts";
import { nowIso, type SqlDatabase, type SqlValue } from "./sql.ts";

export const KB_CATEGORIAS = ["faq", "politica", "promo", "vocabulario", "otro"] as const;
export type KbCategoria = (typeof KB_CATEGORIAS)[number];

export const kbInputSchema = z
  .object({
    categoria: z.enum(KB_CATEGORIAS),
    tema: z.string().trim().min(1, "Falta el tema.").max(120, "El tema admite hasta 120 caracteres."),
    contenido: z.string().trim().min(1, "Falta el contenido.").max(1000, "El contenido admite hasta 1000 caracteres."),
    /** Sinónimos y formas de decirlo ("abren, cierran, hora"): ayudan a que el agente encuentre la entrada. Opcional. */
    palabras_clave: z.string().trim().max(300, "Las palabras clave admiten hasta 300 caracteres.").optional(),
    activo: z.boolean().optional(),
    orden: z.number().int().min(0).max(9999).optional(),
  })
  .strict();

export type KbInput = z.infer<typeof kbInputSchema>;

export interface KbEntry {
  id: string;
  categoria: KbCategoria;
  tema: string;
  contenido: string;
  palabras_clave: string;
  activo: boolean;
  orden: number;
  updated_at: string;
}

interface KbRow {
  id: string;
  categoria: KbCategoria;
  tema: string;
  contenido: string;
  palabras_clave: string;
  activo: number;
  orden: number;
  updated_at: string;
}

const COLS = "id, categoria, tema, contenido, palabras_clave, activo, orden, updated_at";
/** Tope de entradas que lista el panel (y que acepta la carga por archivo). */
export const KB_MAX_ROWS = 300;

const toApi = (r: KbRow): KbEntry => ({ ...r, activo: r.activo === 1 });

async function getEntry(db: SqlDatabase, id: string): Promise<KbEntry | null> {
  const row = await db.prepare(`SELECT ${COLS} FROM kb_negocio WHERE id = ?`).bind(id).first<KbRow>();
  return row ? toApi(row) : null;
}

export async function listKb(db: SqlDatabase, actor: Actor): Promise<KbEntry[]> {
  requireStaff(actor);
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM kb_negocio ORDER BY categoria, orden, tema LIMIT ?`)
    .bind(KB_MAX_ROWS)
    .all<KbRow>();
  return results.map(toApi);
}

export async function createKb(db: SqlDatabase, actor: Actor, id: string, input: KbInput): Promise<KbEntry> {
  requireStaff(actor);
  await db
    .prepare("INSERT INTO kb_negocio (id, categoria, tema, contenido, palabras_clave, activo, orden) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, input.categoria, input.tema, input.contenido, input.palabras_clave ?? "", input.activo === false ? 0 : 1, input.orden ?? 0)
    .run();
  const row = await getEntry(db, id);
  if (!row) throw new Error("Entrada no creada");
  return row;
}

const EDITABLE = new Set(["categoria", "tema", "contenido", "palabras_clave", "activo", "orden"]);

/** Devuelve null si la entrada no existe. */
export async function updateKb(db: SqlDatabase, actor: Actor, id: string, patch: Partial<KbInput>): Promise<KbEntry | null> {
  requireStaff(actor);
  const entries = Object.entries(patch).filter(([, v]) => v !== undefined);
  const unknown = entries.filter(([k]) => !EDITABLE.has(k)).map(([k]) => k);
  if (unknown.length) throw new Error(`Campos no editables: ${unknown.join(", ")}`);
  if (!(await getEntry(db, id))) return null;
  if (entries.length === 0) return getEntry(db, id);
  const sets = [...entries.map(([k]) => `${k} = ?`), "updated_at = ?"];
  const values: SqlValue[] = [...entries.map(([k, v]) => (k === "activo" ? (v ? 1 : 0) : (v as SqlValue))), nowIso()];
  await db.prepare(`UPDATE kb_negocio SET ${sets.join(", ")} WHERE id = ?`).bind(...values, id).run();
  return getEntry(db, id);
}

export async function deleteKb(db: SqlDatabase, actor: Actor, id: string): Promise<boolean> {
  requireStaff(actor);
  const r = await db.prepare("DELETE FROM kb_negocio WHERE id = ?").bind(id).run();
  return r.meta.changes === 1;
}
