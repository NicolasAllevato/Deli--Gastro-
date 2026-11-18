import { NextRequest, NextResponse } from "next/server";
import { anon, dataFor, fromCents } from "@/lib/data";
import { groupForPdf, renderMenuPdf } from "@/lib/menu-pdf";
import { formatDateAR } from "@/lib/time-ar";
import { getClientIp, rateLimit } from "@/utils/rate-limit";

/**
 * Carta pública en PDF: los mismos productos que ve el portal del cliente (activos y visibles), por categoría
 * y con precio. La manda el bot de WhatsApp como documento. Caché corta para que un cambio de precio llegue rápido.
 */
export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 30, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  try {
    const data = await dataFor(anon());
    const [products, categories, name] = await Promise.all([
      data.catalog.products(),
      data.catalog.categories(),
      data.catalog.getConfig("negocio_nombre"),
    ]);
    const businessName = typeof name === "string" && name.trim() ? name.trim().slice(0, 80) : "Nuestra carta";
    const today = formatDateAR(new Date());
    const pdf = renderMenuPdf({
      businessName,
      categories: groupForPdf(products.map((p) => ({ name: p.name, price: fromCents(p.price_cents), category_id: p.category_id })), categories),
      footer: `Precios vigentes al ${today}. Sujetos a cambios.`,
    });
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="carta.pdf"',
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  } catch (error: unknown) {
    console.error("[carta.pdf] no se pudo generar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo generar la carta." }, { status: 500 });
  }
}
