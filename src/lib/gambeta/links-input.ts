/** Validación del guardado de vínculos (PUT /api/admin/sitio/links): forma del pedido y existencia en la carta del sitio. */
import { z } from "zod";
import type { SiteCategory, SitePromotion } from "./schemas.ts";

const id = z.string().trim().min(1).max(64);

const linkSchema = z
  .object({
    appProductId: id,
    /** null = quitar el vínculo. */
    site: z
      .object({
        kind: z.enum(["product", "promotion"]),
        siteId: id,
        siteVariantId: id.nullable().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();

export const putLinksSchema = z
  .object({ links: z.array(linkSchema).min(1, "No hay cambios para guardar.").max(500, "Son demasiados cambios juntos.") })
  .strict()
  .refine((v) => new Set(v.links.map((l) => l.appProductId)).size === v.links.length, {
    message: "Un producto aparece más de una vez.",
  });

export type PutLinksInput = z.infer<typeof putLinksSchema>;

export interface LinkChange {
  appProductId: string;
  link: { kind: "product" | "promotion"; siteId: string; siteVariantId: string | null } | null;
}

/** Devuelve los cambios normalizados o el primer error (en español) si algo no existe en la carta recién leída. */
export function validateAgainstSite(
  input: PutLinksInput,
  catalog: readonly SiteCategory[],
  promotions: readonly SitePromotion[],
): { ok: true; changes: LinkChange[] } | { ok: false; error: string } {
  const products = new Map(catalog.flatMap((c) => c.products).map((p) => [p.id, p]));
  const promoIds = new Set(promotions.map((p) => p.id));
  const changes: LinkChange[] = [];
  for (const l of input.links) {
    if (!l.site) {
      changes.push({ appProductId: l.appProductId, link: null });
      continue;
    }
    const { kind, siteId } = l.site;
    const siteVariantId = l.site.siteVariantId ?? null;
    if (kind === "promotion") {
      if (!promoIds.has(siteId)) return { ok: false, error: "Una de las promociones elegidas ya no existe en el sitio." };
      if (siteVariantId) return { ok: false, error: "Las promociones no llevan variante." };
    } else {
      const product = products.get(siteId);
      if (!product) return { ok: false, error: "Uno de los productos elegidos ya no existe en el sitio." };
      if (siteVariantId && !product.variants.some((v) => v.id === siteVariantId)) {
        return { ok: false, error: `La variante elegida ya no existe en «${product.name}».` };
      }
    }
    changes.push({ appProductId: l.appProductId, link: { kind, siteId, siteVariantId } });
  }
  return { ok: true, changes };
}
