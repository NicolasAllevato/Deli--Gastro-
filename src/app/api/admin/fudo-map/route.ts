import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { fetchFudoCatalog, fudoGatewayConfig } from "@/lib/fudo/gateway";
import { applyCatalogNames, findUnknownFudoIds, loadMapping, saveMapping, saveSchema } from "@/lib/fudo/mapping";

// Mapeo de productos y medios de pago de la app con Fudo (tablas fudo_product_map / fudo_payment_map).
// El catálogo de Fudo se pide al Worker si la integración está configurada; si no, queda vacío y se carga a mano.

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  try {
    const config = fudoGatewayConfig();
    const [mapping, catalog] = await Promise.all([loadMapping(createAdminClient()), fetchFudoCatalog(config)]);
    return NextResponse.json({ ...mapping, catalog, gatewayConfigured: config !== null });
  } catch (error: unknown) {
    console.error("[admin/fudo-map] leer", error);
    return NextResponse.json({ error: "No se pudo leer el mapeo de Fudo." }, { status: 500 });
  }
}

async function save(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const parsed = saveSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  try {
    const catalog = parsed.data.products.length > 0 ? await fetchFudoCatalog() : [];
    const unknown = findUnknownFudoIds(parsed.data.products, catalog);
    if (unknown.length > 0) {
      return NextResponse.json(
        { error: `Ese id no figura en el catálogo de Fudo: ${unknown.join(", ")}. Revisalo para no enviar el plato equivocado.` },
        { status: 400 },
      );
    }
    const db = createAdminClient();
    const requeued = await saveMapping(db, { ...parsed.data, products: applyCatalogNames(parsed.data.products, catalog) });
    return NextResponse.json({ ...(await loadMapping(db)), requeued });
  } catch (error: unknown) {
    console.error("[admin/fudo-map] guardar", error);
    return NextResponse.json({ error: "No se pudo guardar el mapeo." }, { status: 500 });
  }
}

export const PUT = save;
export const POST = save;
