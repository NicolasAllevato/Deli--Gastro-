import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { fetchFudoCatalog, fetchFudoPaymentMethods, fudoGatewayConfig } from "@/lib/fudo/gateway";
import { buildMapResponse, buildPaymentUsage, loadPaymentUsageRows, safeCountSkippedOrders, loadMapping } from "@/lib/fudo/mapping";
import { processSaveRequest } from "@/lib/fudo/save-request";

// Mapeo de productos y medios de pago de la app con Fudo (tablas fudo_product_map / fudo_payment_map).
// El catálogo de Fudo se pide al Worker si la integración está configurada; si no, queda vacío y se carga a mano.

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  try {
    const config = fudoGatewayConfig();
    const db = createAdminClient();
    const [mapping, catalog, skipped, paymentCatalog, usageRows] = await Promise.all([
      loadMapping(db), fetchFudoCatalog(config), safeCountSkippedOrders(db), fetchFudoPaymentMethods(config),
      // La distribución es accesoria: si falla, la pantalla de mapeo sigue funcionando.
      loadPaymentUsageRows(db).catch((error: unknown) => {
        console.error("[admin/fudo-map] distribución de pagos", error instanceof Error ? error.message : "error");
        return [];
      }),
    ]);
    // En modo demo hay un Fudo simulado: la pantalla se comporta como con el gateway configurado.
    const demo = isDemoMode();
    return NextResponse.json({ ...buildMapResponse(mapping, catalog, config !== null || demo, skipped, paymentCatalog, buildPaymentUsage(usageRows, paymentCatalog)), demo });
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
    const hasPayments = Array.isArray((body as { payments?: unknown } | null)?.payments) && ((body as { payments: unknown[] }).payments.length > 0);
    const [catalog, paymentCatalog] = await Promise.all([hasProducts ? fetchFudoCatalog() : [], hasPayments ? fetchFudoPaymentMethods() : []]);
    const result = await processSaveRequest(createAdminClient(), body, catalog, paymentCatalog);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error: unknown) {
    console.error("[admin/fudo-map] guardar", error);
    return NextResponse.json({ error: "No se pudo guardar el mapeo." }, { status: 500 });
  }
}

export const PUT = save;
export const POST = save;
