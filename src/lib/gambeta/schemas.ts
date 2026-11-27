/**
 * Esquemas de las respuestas de la API del sitio web de la pizzería (`/api/v1`).
 * Son tolerantes a propósito: un campo extra (passthrough) o uno nuevo no rompe la integración; solo se exige lo que
 * esta app usa para vincular y traer fotos.
 */
import { z } from "zod";

export const CHANNEL_VISIBILITY = ["salon", "delivery", "ambos"] as const;
export type ChannelVisibility = (typeof CHANNEL_VISIBILITY)[number];

const nullableString = z.string().nullish();
const flag = z.union([z.boolean(), z.number()]).nullish();

export const siteVariantSchema = z
  .object({
    id: z.string(),
    product_id: z.string().optional(),
    label: z.string(),
    unit: nullableString,
    portion_count: z.number().nullish(),
    sort_order: z.number().nullish(),
  })
  .passthrough();

export const sitePriceSchema = z
  .object({
    id: z.string().optional(),
    product_id: z.string().optional(),
    variant_id: z.string().nullish(),
    channel: z.string(),
    amount: z.number().nullish(),
    currency: nullableString,
    active: flag,
  })
  .passthrough();

export const siteProductSchema = z
  .object({
    id: z.string(),
    category_id: z.string().optional(),
    name: z.string(),
    description: nullableString,
    image_url: nullableString,
    active: flag,
    sort_order: z.number().nullish(),
    review_status: nullableString,
    variants: z.array(siteVariantSchema).default([]),
    prices: z.array(sitePriceSchema).default([]),
  })
  .passthrough();

export const siteCategorySchema = z
  .object({
    id: z.string(),
    slug: nullableString,
    name: z.string(),
    subtitle: nullableString,
    channel_visibility: z.string().default("ambos"),
    sort_order: z.number().nullish(),
    active: flag,
    products: z.array(siteProductSchema).default([]),
  })
  .passthrough();

export const sitePromotionItemSchema = z
  .object({
    id: z.string().optional(),
    promotion_id: z.string().optional(),
    product_id: z.string().nullish(),
    quantity: z.number().nullish(),
    variant_id: z.string().nullish(),
  })
  .passthrough();

export const sitePromotionSchema = z
  .object({
    id: z.string(),
    slug: nullableString,
    name: z.string(),
    description: nullableString,
    price: z.number().nullish(),
    channel: nullableString,
    active: flag,
    start_at: nullableString,
    end_at: nullableString,
    terms: nullableString,
    image_url: nullableString,
    items: z.array(sitePromotionItemSchema).default([]),
  })
  .passthrough();

export const siteBusinessSchema = z.object({}).passthrough();

export type SiteVariant = z.infer<typeof siteVariantSchema>;
export type SiteProduct = z.infer<typeof siteProductSchema>;
export type SiteCategory = z.infer<typeof siteCategorySchema>;
export type SitePromotion = z.infer<typeof sitePromotionSchema>;

/** Sobre de la API: `{success:true,data}` o `{success:false,error}`. */
export function envelopeSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("success", [
    z.object({ success: z.literal(true), data }).passthrough(),
    z.object({ success: z.literal(false), error: z.string().optional() }).passthrough(),
  ]);
}

export const catalogSchema = z.array(siteCategorySchema);
export const promotionsSchema = z.array(sitePromotionSchema);
