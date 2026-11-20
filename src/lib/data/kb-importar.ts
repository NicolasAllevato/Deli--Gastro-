/**
 * Carga de preguntas frecuentes desde un archivo a `kb_negocio` (categoría faq). El archivo ya lo leyó el parser
 * (src/lib/kb/faq-file.ts); acá se detectan los duplicados por tema y se guardan en lotes. Solo staff.
 */
import { requireStaff, type Actor } from "./actor.ts";
import { KB_MAX_ROWS, kbInputSchema } from "./kb-negocio.ts";
import { faqKey, type FaqItem } from "../kb/faq-file.ts";
import type { SqlDatabase, SqlStatement } from "./sql.ts";
import { nowIso } from "./sql.ts";

/** Entrada que ya existe con el mismo tema (sin tildes, mayúsculas ni signos). */
export interface FaqDuplicate {
  id: string;
  categoria: string;
  tema: string;
}

export interface FaqImportRow extends FaqItem {
  duplicado: FaqDuplicate | null;
  /** true = el mismo tema ya apareció antes en lo que se está cargando. */
  repetido: boolean;
}

export interface FaqImportResult {
  insertadas: number;
  reemplazadas: number;
  salteadas: number;
}

/** No entran todas las preguntas: la base tiene un tope de entradas (KB_MAX_ROWS). */
export class KbCapacityError extends Error {
  readonly existentes: number;
  readonly nuevas: number;

  constructor(existentes: number, nuevas: number) {
    super(`No entran ${nuevas} entradas nuevas: hay ${existentes} cargadas y el tope es ${KB_MAX_ROWS}.`);
    // handleFaqImport lo reconoce por el nombre (sin importar la clase): un 409 y no un 500.
    this.name = "KbCapacityError";
    this.existentes = existentes;
    this.nuevas = nuevas;
  }
}

/** Sentencias por lote de D1. */
const BATCH_SIZE = 100;
const EXISTING_LIMIT = 2000;

/** Marca los duplicados contra lo que ya está cargado (cualquier categoría salvo vocabulario) y dentro del propio archivo. */
export async function previewFaqImport(
  db: SqlDatabase,
  actor: Actor,
  items: readonly FaqItem[],
): Promise<{ rows: FaqImportRow[]; existentes: number }> {
  requireStaff(actor);
  const [existing, total] = await Promise.all([
    db
      .prepare("SELECT id, categoria, tema FROM kb_negocio WHERE categoria <> 'vocabulario' ORDER BY created_at LIMIT ?")
      .bind(EXISTING_LIMIT)
      .all<FaqDuplicate>(),
    db.prepare("SELECT count(*) AS c FROM kb_negocio").first<{ c: number }>(),
  ]);
  const byKey = new Map<string, FaqDuplicate>();
  for (const e of existing.results) {
    const key = faqKey(e.tema);
    if (key && !byKey.has(key)) byKey.set(key, e);
  }
  const seen = new Set<string>();
  const rows = items.map((item) => {
    const key = faqKey(item.tema);
    const repetido = seen.has(key);
    seen.add(key);
    return { ...item, duplicado: byKey.get(key) ?? null, repetido };
  });
  return { rows, existentes: Number(total?.c ?? 0) };
}

/**
 * Guarda las preguntas elegidas como categoría faq. Un duplicado se saltea, salvo `reemplazar`: entonces se actualiza la respuesta
 * (y las palabras clave si el archivo las trae) de la entrada que ya existe, sin cambiar su categoría, su tema ni si está activa.
 * Lo repetido dentro del archivo se saltea siempre. Lanza KbCapacityError si las nuevas no entran en el tope.
 */
export async function saveFaqImport(
  db: SqlDatabase,
  actor: Actor,
  items: readonly FaqItem[],
  opts: { reemplazar: boolean },
  newId: () => string,
): Promise<FaqImportResult> {
  requireStaff(actor);
  const { rows, existentes } = await previewFaqImport(db, actor, items);
  const result: FaqImportResult = { insertadas: 0, reemplazadas: 0, salteadas: 0 };
  const statements: SqlStatement[] = [];
  const now = nowIso();

  for (const row of rows) {
    // Defensa en profundidad: los topes de la base se vuelven a validar aunque el parser ya los respetó.
    const valid = kbInputSchema.safeParse({ categoria: "faq", tema: row.tema, contenido: row.contenido, palabras_clave: row.palabras_clave });
    if (!valid.success || row.repetido || (row.duplicado && !opts.reemplazar)) {
      result.salteadas += 1;
    } else if (row.duplicado) {
      statements.push(
        db
          .prepare("UPDATE kb_negocio SET contenido = ?, palabras_clave = CASE WHEN ? <> '' THEN ? ELSE palabras_clave END, updated_at = ? WHERE id = ?")
          .bind(valid.data.contenido, valid.data.palabras_clave ?? "", valid.data.palabras_clave ?? "", now, row.duplicado.id),
      );
      result.reemplazadas += 1;
    } else {
      statements.push(
        db
          .prepare("INSERT INTO kb_negocio (id, categoria, tema, contenido, palabras_clave, activo, orden) VALUES (?, 'faq', ?, ?, ?, 1, 0)")
          .bind(newId(), valid.data.tema, valid.data.contenido, valid.data.palabras_clave ?? ""),
      );
      result.insertadas += 1;
    }
  }

  if (existentes + result.insertadas > KB_MAX_ROWS) throw new KbCapacityError(existentes, result.insertadas);
  for (let i = 0; i < statements.length; i += BATCH_SIZE) await db.batch(statements.slice(i, i + BATCH_SIZE));
  return result;
}
