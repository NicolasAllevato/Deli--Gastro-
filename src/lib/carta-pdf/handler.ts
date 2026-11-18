import { NextRequest, NextResponse } from "next/server";
import { anon, cartaApp, dataFor, fromCents } from "@/lib/data";
import { formatDateAR } from "@/lib/time-ar";
import { getClientIp, rateLimit } from "@/utils/rate-limit";
import { seccionesDesdeCarta, seccionesDesdeCategorias } from "./build";
import { renderCartaPdf } from "./render";

/**
 * Carta pública en PDF con el diseño de la carta impresa. Con carta estructurada (/admin/carta) usa sus secciones
 * y líneas; sin ella, los productos del portal por categoría. Precios siempre vivos desde los productos.
 * Caché corta con stale-while-revalidate: un cambio de precio llega en minutos. La comparten
 * /api/public/carta.pdf (la manda el bot) y /carta.pdf (link fijo para el QR).
 */
export async function cartaPdfResponse(req: NextRequest): Promise<NextResponse> {
  if (!(await rateLimit(getClientIp(req), 30, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  try {
    const actor = anon();
    let secciones = seccionesDesdeCarta(await cartaApp.publica(actor));
    if (secciones.length === 0) {
      const data = await dataFor(actor);
      const [products, categories] = await Promise.all([data.catalog.products(), data.catalog.categories()]);
      secciones = seccionesDesdeCategorias(
        products.map((p) => ({ name: p.name, price: fromCents(p.price_cents), category_id: p.category_id })),
        categories,
      );
    }
    const pdf = renderCartaPdf({ secciones, footer: `Precios vigentes al ${formatDateAR(new Date())}. Sujetos a cambios.` });
    const download = req.nextUrl.searchParams.get("descargar") === "1";
    return new NextResponse(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="carta-la-gambeta.pdf"`,
        "Cache-Control": "public, max-age=300, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error: unknown) {
    console.error("[carta.pdf] no se pudo generar", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "No se pudo generar la carta." }, { status: 500 });
  }
}
