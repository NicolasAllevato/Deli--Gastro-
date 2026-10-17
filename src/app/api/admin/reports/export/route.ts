import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { inBounds, RANGE_KEYS, rangeBounds, type RangeKey } from "@/lib/reports/range";
import { toCsv } from "@/lib/reports/csv";
import { loadReportData } from "@/lib/reports/data";

const rangeSchema = z.enum(RANGE_KEYS as [RangeKey, ...RangeKey[]]);

const HEADERS = ["Fecha", "Pedido", "Cliente", "Estado", "Canal", "Pago", "Total", "Envío"];

const localDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" });

/** Pedidos del período en CSV (para contabilidad o planillas). */
export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const range = rangeSchema.safeParse(req.nextUrl.searchParams.get("range") ?? "last_30_days");
  if (!range.success) return NextResponse.json({ error: "Período inválido." }, { status: 400 });

  const data = await loadReportData(createAdminClient());
  const bounds = rangeBounds(range.data);
  const names = new Map(data.clients.map((c) => [c.id, c.name]));

  const rows = data.orders
    .filter((o) => inBounds(o.created_at, bounds))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((o) => [
      localDateTime(o.created_at),
      `#${o.id.slice(0, 8).toUpperCase()}`,
      (o.client_id && names.get(o.client_id)) || "Mostrador",
      o.status,
      o.channel,
      o.payment_method ?? "",
      o.total,
      o.delivery_fee,
    ]);

  // BOM para que Excel abra los acentos bien.
  return new NextResponse(`﻿${toCsv(HEADERS, rows)}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="pedidos-${range.data}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
