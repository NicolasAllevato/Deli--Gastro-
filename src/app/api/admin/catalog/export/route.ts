import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { toCsv } from "@/lib/reports/csv";
import { loadCatalog } from "@/lib/catalog/apply";
import { CATALOG_HEADERS, productsToRows } from "@/lib/catalog/sheet";
import { XLSX_MIME, buildCatalogXlsx } from "@/lib/catalog/workbook";

/** Descarga la carta completa (incluye inactivos) como Excel (`format=xlsx`) o CSV. */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const format = req.nextUrl.searchParams.get("format") ?? "xlsx";
  if (format !== "xlsx" && format !== "csv") {
    return NextResponse.json({ error: "Formato inválido." }, { status: 400 });
  }

  let rows;
  try {
    const { products, categories } = await loadCatalog(createAdminClient());
    rows = productsToRows(products, categories);
  } catch (e: unknown) {
    console.error("[catalog/export]", e);
    return NextResponse.json({ error: "No se pudo generar la exportación de la carta." }, { status: 500 });
  }

  const headers = { "Cache-Control": "no-store", "Content-Disposition": `attachment; filename="carta.${format}"` };

  if (format === "csv") {
    // `;` y BOM: así Excel en español abre las columnas y los acentos bien.
    return new NextResponse(`\uFEFF${toCsv(CATALOG_HEADERS, rows, ";")}`, {
      headers: { ...headers, "Content-Type": "text/csv; charset=utf-8" },
    });
  }

  const file = await buildCatalogXlsx(rows);
  return new NextResponse(new Uint8Array(file), { headers: { ...headers, "Content-Type": XLSX_MIME } });
}
