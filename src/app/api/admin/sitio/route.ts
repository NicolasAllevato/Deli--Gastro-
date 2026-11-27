import { NextRequest, NextResponse } from "next/server";
import { siteLinksApp } from "@/lib/data";
import { suggestLinks } from "@/lib/gambeta/match";
import { gambetaClient, gambetaMessage, guard, loadSite, serverError } from "@/lib/gambeta/server";
import type { SiteCategory, SitePromotion } from "@/lib/gambeta/schemas";

/** Carta y promociones del sitio, resumidas para los selectores de la pantalla. */
function summarizeSite(catalog: SiteCategory[], promotions: SitePromotion[]) {
  return {
    categories: catalog.map((c) => ({
      id: c.id,
      name: c.name,
      channel: c.channel_visibility,
      products: c.products.map((p) => ({
        id: p.id,
        name: p.name,
        hasPhoto: !!p.image_url?.trim(),
        variants: p.variants.map((v) => ({ id: v.id, label: v.label })),
      })),
    })),
    promotions: promotions.map((p) => ({ id: p.id, name: p.name, hasPhoto: !!p.image_url?.trim() })),
  };
}

/** Estado de la conexión con el sitio, productos de la app, vínculos guardados y sugerencias para los que faltan. */
export async function GET(req: NextRequest) {
  const { denied, actor } = await guard(req, 30);
  if (denied || !actor) return denied;
  try {
    const [products, links] = await Promise.all([siteLinksApp.products(actor), siteLinksApp.list(actor)]);
    const client = gambetaClient();
    const base = { products, links };
    if (!client.hasKey) {
      return NextResponse.json({ ...base, connection: { hasKey: false, ok: false, error: "Falta cargar la clave de la API del sitio web." }, site: null, suggestions: [] });
    }
    try {
      const { catalog, promotions } = await loadSite(client);
      const linked = new Set(links.map((l) => l.appProductId));
      const pending = products.filter((p) => !linked.has(p.id)).map((p) => ({ id: p.id, name: p.name, categoryName: p.categoryName }));
      return NextResponse.json({
        ...base,
        connection: { hasKey: true, ok: true },
        site: summarizeSite(catalog, promotions),
        suggestions: suggestLinks(pending, catalog, promotions),
      });
    } catch (err) {
      return NextResponse.json({ ...base, connection: { hasKey: true, ok: false, error: gambetaMessage(err) }, site: null, suggestions: [] });
    }
  } catch (err) {
    return serverError("leer", err);
  }
}
