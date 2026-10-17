import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { applyImportPlan, loadCatalog } from "@/lib/catalog/apply";
import { parseCatalogRows, planImport } from "@/lib/catalog/sheet";
import { readCatalogFile } from "@/lib/catalog/workbook";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const PREVIEW_ROWS = 100;

/**
 * Importa la carta desde Excel o CSV. Con `apply=true` guarda los cambios; sin eso solo
 * devuelve la vista previa (qué se crea, qué cambia y qué filas tienen errores).
 * Nunca borra productos: lo que no está en el archivo queda como está.
 */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 10);
  if (denied) return denied;

  let file: File;
  let apply = false;
  try {
    const form = await req.formData();
    const candidate = form.get("file");
    if (!(candidate instanceof File)) return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    file = candidate;
    apply = form.get("apply") === "true";
  } catch {
    return NextResponse.json({ error: "No se pudo leer el formulario." }, { status: 400 });
  }

  if (!/\.(xlsx|csv)$/i.test(file.name)) {
    return NextResponse.json({ error: "Formato no permitido. Usá un archivo .xlsx o .csv." }, { status: 400 });
  }
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 5MB." }, { status: 400 });
  }

  let sheet;
  try {
    sheet = await readCatalogFile(file.name, await file.arrayBuffer());
  } catch (e: unknown) {
    const message = e instanceof Error && /máximo/.test(e.message) ? e.message : "No se pudo leer el archivo. ¿Es un Excel o CSV válido?";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const parsed = parseCatalogRows(sheet);
  if (parsed.rows.length === 0 && parsed.errors.length > 0 && parsed.errors[0].line === 1) {
    return NextResponse.json({ error: parsed.errors[0].message }, { status: 400 });
  }

  try {
    const db = createAdminClient();
    const { products, categories } = await loadCatalog(db);
    const plan = planImport(parsed.rows, products, categories);
    const errors = [...parsed.errors, ...plan.errors].sort((a, b) => a.line - b.line);

    if (!apply) {
      return NextResponse.json({
        creates: plan.creates.slice(0, PREVIEW_ROWS),
        updates: plan.updates.slice(0, PREVIEW_ROWS).map(({ line, id, name, changes, patch }) => ({ line, id, name, changes, patch })),
        totals: { creates: plan.creates.length, updates: plan.updates.length, unchanged: plan.unchanged, errors: errors.length },
        newCategories: plan.newCategories,
        errors: errors.slice(0, PREVIEW_ROWS),
      });
    }

    // Las filas con error no se aplican; el resto sí (el resumen lo aclara).
    const result = await applyImportPlan(db, plan, categories);
    return NextResponse.json({ ...result, unchanged: plan.unchanged, skipped: errors.length });
  } catch (e: unknown) {
    console.error("[catalog/import]", e);
    return NextResponse.json({ error: "No se pudo importar la carta." }, { status: 500 });
  }
}
