import { NextRequest, NextResponse } from "next/server";
import { kbApp, KB_MAX_ROWS } from "@/lib/data";
import { handleFaqImport, MAX_IMPORT_BODY_BYTES } from "@/lib/kb/faq-import-request";
import { guard } from "../guard";

/**
 * Carga de preguntas frecuentes desde un archivo (.txt, .md, .csv). Solo admin, con el mismo guard que /api/admin/conocimiento
 * (sesión, origen y tope por IP, más bajo acá). El cuerpo lleva el texto del archivo: se lee con tope de tamaño, se vuelve a
 * interpretar en el servidor y nunca se guardan ítems que mande el cliente.
 */

/** Lee el cuerpo como JSON sin pasar de `maxBytes` (si no entra, null y no se sigue leyendo). */
async function readJsonLimited(req: NextRequest, maxBytes: number): Promise<{ tooLarge: boolean; json: unknown }> {
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes) return { tooLarge: true, json: null };
  const reader = req.body?.getReader();
  if (!reader) return { tooLarge: false, json: null };
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return { tooLarge: true, json: null };
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return { tooLarge: false, json: JSON.parse(new TextDecoder().decode(bytes)) };
  } catch {
    return { tooLarge: false, json: null };
  }
}

export async function POST(req: NextRequest) {
  const { denied, actor } = await guard(req, 10);
  if (denied || !actor) return denied;
  const { tooLarge, json } = await readJsonLimited(req, MAX_IMPORT_BODY_BYTES);
  if (tooLarge) return NextResponse.json({ error: "El archivo es demasiado grande." }, { status: 413 });
  try {
    const { status, body } = await handleFaqImport(json, {
      limit: KB_MAX_ROWS,
      preview: (items) => kbApp.importPreview(actor, items),
      save: (items, opts) => kbApp.importSave(actor, items, opts),
    });
    return NextResponse.json(body, { status });
  } catch (err) {
    console.error("[conocimiento/importar]", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
  }
}
