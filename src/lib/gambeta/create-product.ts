/**
 * Crear en el sitio un producto de la app que todavía no tiene vínculo (`POST /products`) y dejar el vínculo guardado.
 */
import { z } from "zod";
import type { PublishStore } from "../data/site-publish.ts";
import type { GambetaClient } from "./client.ts";
import { parseAppName } from "./match.ts";
import { channelsFor } from "./publish-plan.ts";
import { shortError, uploadAppPhoto, type PublishDeps } from "./publish.ts";
import type { SiteCategory } from "./schemas.ts";

export const createProductSchema = z
  .object({
    appProductId: z.string().trim().min(1).max(64),
    siteCategoryId: z.string().trim().min(1).max(64),
  })
  .strict();

export class CreateProductError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "CreateProductError";
    this.status = status;
  }
}

const PREFIX = /^(grande de|grande|gde|porci[oó]n de|porci[oó]n|empanada de|empanada)\s+/i;

/** «Grande de muzzarella» → «Muzzarella» (sin los prefijos de tamaño de Fudo). */
export function cleanProductName(raw: string): string {
  const base = raw.replace(/\s+/g, " ").trim().replace(PREFIX, "").trim() || raw.trim();
  return base.charAt(0).toUpperCase() + base.slice(1);
}

const HINT_VARIANT = {
  entera: { label: "Entera" },
  porcion: { label: "Porción" },
  unidad: { label: "unidad", unit: "unidad" },
} as const;

/** Cuerpo del `POST /products`: nombre limpio, una variante si el nombre la indica y los precios del canal de la categoría. */
export function buildCreateBody(
  app: { name: string; priceCents: number },
  category: Pick<SiteCategory, "id" | "channel_visibility">,
  imageUrl?: string,
): Record<string, unknown> {
  const hint = parseAppName(app.name).hint;
  const variant = hint ? { id: "new:a", ...HINT_VARIANT[hint] } : null;
  const amount = Math.round(app.priceCents / 100);
  return {
    category_id: category.id,
    name: cleanProductName(app.name),
    active: true,
    ...(imageUrl ? { image_url: imageUrl } : {}),
    ...(variant ? { variants: [variant] } : {}),
    prices: channelsFor(category.channel_visibility).map((channel) => ({ ...(variant ? { variant_id: variant.id } : {}), channel, amount, active: true })),
  };
}

export interface CreateProductDeps extends Pick<PublishDeps, "fetchImpl" | "publicBaseUrl" | "now"> {
  store: PublishStore;
  client: GambetaClient;
  linkedBy: string | null;
}

export interface CreateProductResult {
  siteId: string;
  siteVariantId: string | null;
  photo: "subida" | "sin_foto" | "fallo";
  photoError?: string;
}

export async function createProductOnSite(deps: CreateProductDeps, input: z.infer<typeof createProductSchema>): Promise<CreateProductResult> {
  const app = await deps.store.getAppProduct(input.appProductId);
  if (!app) throw new CreateProductError("El producto de la app no existe.", 404);
  if (app.priceCents <= 0) throw new CreateProductError("El producto no tiene precio: cargalo en Fudo antes de publicarlo.");
  if ((await deps.store.listLinks()).some((l) => l.appProductId === app.id)) {
    throw new CreateProductError("Este producto ya está vinculado con el sitio.", 409);
  }
  let category: SiteCategory | undefined;
  try {
    category = (await deps.client.getCatalog()).find((c) => c.id === input.siteCategoryId);
  } catch (err) {
    throw new CreateProductError(shortError(err), 502);
  }
  if (!category) throw new CreateProductError("La categoría elegida no existe en el sitio.");

  let imageUrl: string | undefined;
  let photo: CreateProductResult["photo"] = "sin_foto";
  let photoError: string | undefined;
  if (app.imageUrl) {
    try {
      imageUrl = await uploadAppPhoto(deps, app.imageUrl, "products");
      photo = "subida";
    } catch (err) {
      photo = "fallo";
      photoError = shortError(err);
    }
  }
  let created;
  try {
    created = await deps.client.createProduct(buildCreateBody(app, category, imageUrl));
  } catch (err) {
    throw new CreateProductError(shortError(err), 502);
  }
  const wantedLabel = HINT_VARIANT[parseAppName(app.name).hint ?? "entera"].label;
  const hasHint = parseAppName(app.name).hint !== null;
  const variantId = hasHint ? (created.variants.find((v) => v.label === wantedLabel)?.id ?? created.variants[0]?.id ?? null) : null;
  await deps.store.insertLink({
    appProductId: app.id,
    siteId: created.id,
    siteVariantId: variantId,
    linkedBy: deps.linkedBy,
    pushedImageUrl: photo === "subida" ? app.imageUrl : null,
    pushedAt: (deps.now ?? (() => new Date()))().toISOString(),
  });
  return { siteId: created.id, siteVariantId: variantId, photo, ...(photoError ? { photoError } : {}) };
}
