import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { fetchFudoCatalog, fudoGatewayConfig } from "@/lib/fudo/gateway";
import { buildMapResponse, countSkippedOrders, loadMapping } from "@/lib/fudo/mapping";
import { processSaveRequest } from "@/lib/fudo/save-request";

// Mapeo de productos y medios de pago de la app con Fudo (tablas fudo_product_map / fudo_payment_map).
// El catálogo de Fudo se pide al Worker si la integración está configurada; si no, queda vacío y se carga a mano.

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  try {
    const config = fudoGatewayConfig();
    const db = createAdminClient();
    const [mapping, catalog, skipped] = await Promise.all([loadMapping(db), fetchFudoCatalog(config), countSkippedOrders(db)]);
    return NextResponse.json(buildMapResponse(mapping, catalog, config !== null, skipped));
  } catch (error: unknown) {
    console.error("[admin/fudo-map] leer", error);
    return NextResponse.json({ error: "No se pudo leer el mapeo de Fudo." }, { status: 500 });
  }
}

async function save(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const body: unknown = await req.json().catch(() => null);
  try {
    const hasProducts = Array.isArray((body as { products?: unknown } | null)?.products) && ((body as { products: unknown[] }).products.length > 0);
    const catalog = hasProducts ? await fetchFudoCatalog() : [];
    const result = await processSaveRequest(createAdminClient(), body, catalog);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error: unknown) {
    console.error("[admin/fudo-map] guardar", error);
    return NextResponse.json({ error: "No se pudo guardar el mapeo." }, { status: 500 });
  }
}

export const PUT = save;
export const POST = save;
