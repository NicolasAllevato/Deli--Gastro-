/**
 * Pedido de carga de preguntas frecuentes (POST /api/admin/conocimiento/importar), sin Next ni base de datos: valida el cuerpo,
 * vuelve a leer el archivo en el servidor (nunca se guardan ítems que mande el cliente) y devuelve estado + JSON.
 *  - modo `preview`: lee el archivo y marca los duplicados;
 *  - modo `guardar`: guarda las preguntas elegidas (`seleccion` = posiciones en la vista previa).
 */
import { z } from "zod";
import type { FaqImportResult, FaqImportRow } from "@/lib/data";
import { checkFaqFile, faqFileKind, MAX_FAQ_FILE_BYTES, MAX_FAQ_ITEMS, parseFaqFile, type FaqItem } from "./faq-file.ts";

/** Cuerpo máximo del pedido: el archivo (200 KB) más el escapado JSON y los demás campos. */
export const MAX_IMPORT_BODY_BYTES = 2 * MAX_FAQ_FILE_BYTES;

const bodySchema = z
  .object({
    modo: z.enum(["preview", "guardar"]),
    nombre: z.string().trim().min(1, "Falta el nombre del archivo.").max(200, "El nombre del archivo es demasiado largo."),
    texto: z.string().min(1, "El archivo está vacío.").max(MAX_FAQ_FILE_BYTES, "El archivo es demasiado grande."),
    seleccion: z.array(z.number().int().min(0)).max(MAX_FAQ_ITEMS, `Elegiste demasiadas preguntas (máx. ${MAX_FAQ_ITEMS}).`).optional(),
    reemplazar: z.boolean().optional(),
  })
  .strict();

export interface FaqImportDeps {
  /** Tope de entradas de la base (se informa en la vista previa). */
  limit: number;
  preview(items: FaqItem[]): Promise<{ rows: FaqImportRow[]; existentes: number }>;
  save(items: FaqItem[], opts: { reemplazar: boolean }): Promise<FaqImportResult>;
}

export interface FaqImportResponse {
  status: number;
  body: Record<string, unknown>;
}

const fail = (status: number, error: string): FaqImportResponse => ({ status, body: { error } });

const isCapacityError = (err: unknown): err is Error => err instanceof Error && err.name === "KbCapacityError";

export async function handleFaqImport(raw: unknown, deps: FaqImportDeps): Promise<FaqImportResponse> {
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return fail(400, parsed.error.issues[0]?.message ?? "Datos inválidos.");
  const { modo, nombre, texto, seleccion, reemplazar } = parsed.data;

  if (faqFileKind(nombre) === null) return fail(400, checkFaqFile(nombre, 1) ?? "Extensión no permitida.");
  const bytes = new TextEncoder().encode(texto).length;
  const rejected = checkFaqFile(nombre, bytes);
  if (rejected) return fail(bytes > MAX_FAQ_FILE_BYTES ? 413 : 400, rejected);

  const { items, errores, avisos } = parseFaqFile(nombre, texto);

  if (modo === "preview") {
    if (items.length === 0) return { status: 200, body: { items: [], errores, avisos, existentes: 0, limite: deps.limit } };
    const { rows, existentes } = await deps.preview(items);
    return {
      status: 200,
      body: {
        items: rows.map((r, indice) => ({ indice, tema: r.tema, contenido: r.contenido, palabras_clave: r.palabras_clave, line: r.line, duplicado: r.duplicado, repetido: r.repetido })),
        errores,
        avisos,
        existentes,
        limite: deps.limit,
      },
    };
  }

  if (!seleccion || seleccion.length === 0) return fail(400, "Elegí al menos una pregunta para guardar.");
  const positions = [...new Set(seleccion)].sort((a, b) => a - b);
  if (positions.some((p) => p >= items.length)) return fail(400, "La selección no coincide con el archivo. Volvé a cargarlo.");
  try {
    const result = await deps.save(positions.map((p) => items[p]!), { reemplazar: reemplazar === true });
    return { status: 200, body: { ...result } };
  } catch (err) {
    if (isCapacityError(err)) return fail(409, err.message);
    throw err;
  }
}
