import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { RANGE_KEYS, rangeBounds, type RangeKey } from "@/lib/reports/range";
import { toCsv } from "@/lib/reports/csv";
import { loadClientExportData } from "@/lib/reports/data";
import { clientSummaries } from "@/lib/reports/clientExport";
import { formatDateAR, formatDateTimeAR } from "@/lib/time-ar";

const rangeSchema = z.enum(RANGE_KEYS as [RangeKey, ...RangeKey[]]);

const HEADERS = [
  "Nombre", "Teléfono", "Dirección", "Nivel", "Puntos", "WhatsApp promociones", "Alta",
  "Pedidos", "Cancelados", "Gasto total", "Ticket promedio", "Primer pedido", "Último pedido",
  "Días desde el último pedido", "Producto más pedido",
];

const localDate = (iso: string) => formatDateAR(iso, { dateStyle: "short" });
const localDateTime = (iso: string) =>
  formatDateTimeAR(iso, { dateStyle: "short", timeStyle: "short" });

/**
 * Lista de clientes con sus datos y métricas en CSV. `range` filtra qué pedidos cuentan;
 * `range=all` (o sin parámetro) usa todo el histórico.
 */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const raw = req.nextUrl.searchParams.get("range") ?? "all";
  const range = raw === "all" ? ({ success: true, data: "all" } as const) : rangeSchema.safeParse(raw);
  if (!range.success) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  let summaries;
  try {
    const data = await loadClientExportData(createAdminClient());
    const bounds = range.data === "all" ? null : rangeBounds(range.data);
    summaries = clientSummaries(data.clients, data.orders, bounds);
  } catch (e: unknown) {
    console.error("[clients/export]", e);
    return NextResponse.json({ error: "No se pudo generar la exportación de clientes." }, { status: 500 });
  }

  const rows = summaries.map((c) => [
    c.name,
    // Sin el "+" inicial: si no, la protección contra fórmulas le antepone un apóstrofe en Excel.
    c.phone.replace(/^\+/, ""),
    c.address,
    c.tier,
    c.points,
    c.whatsappOptIn ? "Sí" : "No",
    localDate(c.createdAt),
    c.orders,
    c.cancelled,
    c.spent,
    c.avgTicket,
    c.firstOrderAt ? localDateTime(c.firstOrderAt) : "",
    c.lastOrderAt ? localDateTime(c.lastOrderAt) : "",
    c.daysSinceLast ?? "",
    c.topProduct,
  ]);

  // BOM para que Excel abra los acentos bien.
  return new NextResponse(`\uFEFF${toCsv(HEADERS, rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clientes-${range.data}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
