/**
 * Planificador de la publicación al sitio web. Función pura: compara la app (manda) con el sitio y devuelve las
 * operaciones necesarias, cada una con su descripción legible en español. No toca red ni base.
 */
import type { SiteCategory, SiteProduct, SitePromotion } from "./schemas.ts";

export interface PlanAppProduct {
  id: string;
  name: string;
  priceCents: number;
  imageUrl: string;
  isActive: boolean;
}

export interface PlanLink {
  appProductId: string;
  kind: "product" | "promotion";
  siteId: string;
  siteVariantId: string | null;
  pushedImageUrl: string | null;
}

export interface PricePayload {
  id?: string;
  variant_id: string | null;
  channel: string;
  amount: number;
  active: boolean;
}

export interface PhotoTask {
  sourceUrl: string;
  folder: "products" | "promos";
  /** Vínculos cuya foto es esa: al subirla quedan marcados como «ya enviada». */
  appProductIds: string[];
}

export interface PublishOp {
  kind: "product" | "promotion";
  siteId: string;
  siteName: string;
  /** Cuerpo del PUT sin la foto (la foto se sube aparte y agrega `image_url`). */
  body: Record<string, unknown>;
  photo: PhotoTask | null;
  /** Todos los productos de la app vinculados a este producto/promoción del sitio. */
  appProductIds: string[];
  /** Descripciones legibles, una por cambio. */
  changes: string[];
  deactivates: boolean;
}

export interface PublishPlan {
  ops: PublishOp[];
  warnings: string[];
}

export interface PlanInput {
  appProducts: readonly PlanAppProduct[];
  links: readonly PlanLink[];
  catalog: readonly SiteCategory[];
  promotions: readonly SitePromotion[];
  /** Si viene, solo quedan las operaciones que tocan alguno de estos productos de la app. */
  onlyAppProductIds?: readonly string[];
}

/** Tope de desactivaciones por corrida, como fracción de los productos activos del sitio. */
export const MAX_DEACTIVATION_RATIO = 0.3;

export const formatPesos = (n: number): string => `$${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;

const isOn = (flag: boolean | number | null | undefined): boolean => flag !== false && flag !== 0;

/** Canales de precio que corresponden a la visibilidad de una categoría del sitio. */
export function channelsFor(visibility: string): string[] {
  if (visibility === "salon") return ["salon"];
  if (visibility === "delivery") return ["delivery"];
  return ["salon", "delivery"];
}

const CHANNEL_NAME: Record<string, string> = { salon: "salón", delivery: "delivery" };
const channelName = (c: string): string => CHANNEL_NAME[c] ?? c;

const isWhole = (label: string): boolean => /^(entera|grande)$/i.test(label.trim());

function planPrices(
  site: SiteProduct,
  visibility: string,
  wanted: ReadonlyArray<{ variantId: string | null; amount: number }>,
): { prices: PricePayload[]; changes: string[] } | null {
  const prices: PricePayload[] = site.prices.map((p) => ({
    ...(p.id ? { id: p.id } : {}),
    variant_id: p.variant_id ?? null,
    channel: p.channel,
    amount: p.amount ?? 0,
    active: isOn(p.active),
  }));
  const changes: string[] = [];
  for (const w of wanted) {
    const label = w.variantId ? (site.variants.find((v) => v.id === w.variantId)?.label ?? null) : null;
    const title = label ? `${site.name} · ${label}` : site.name;
    const mine = prices.filter((p) => p.variant_id === w.variantId);
    const olds = new Set<number>();
    let touched = false;
    for (const p of mine) {
      if (p.amount !== w.amount) {
        olds.add(p.amount);
        p.amount = w.amount;
        touched = true;
      }
    }
    if (touched) changes.push(`${title}: ${[...olds].map(formatPesos).join(" / ")} → ${formatPesos(w.amount)}`);
    if (mine.length === 0) {
      const channels = channelsFor(visibility);
      for (const channel of channels) prices.push({ variant_id: w.variantId, channel, amount: w.amount, active: true });
      changes.push(`${title}: precio nuevo ${formatPesos(w.amount)} (${channels.map(channelName).join(" y ")})`);
    }
  }
  return changes.length > 0 ? { prices, changes } : null;
}

/** El vínculo preferido para la foto: variante «Entera» si hay, si no el primero con foto. */
function pickPhoto(
  links: readonly PlanLink[],
  apps: ReadonlyMap<string, PlanAppProduct>,
  wholeVariantIds: ReadonlySet<string>,
): { app: PlanAppProduct; link: PlanLink } | null {
  const withPhoto = links
    .map((link) => ({ link, app: apps.get(link.appProductId) }))
    .filter((x): x is { link: PlanLink; app: PlanAppProduct } => !!x.app && x.app.imageUrl !== "");
  if (withPhoto.length === 0) return null;
  return withPhoto.find((x) => x.link.siteVariantId && wholeVariantIds.has(x.link.siteVariantId)) ?? withPhoto[0];
}

function photoTask(
  links: readonly PlanLink[],
  apps: ReadonlyMap<string, PlanAppProduct>,
  wholeVariantIds: ReadonlySet<string>,
  folder: PhotoTask["folder"],
): PhotoTask | null {
  const pick = pickPhoto(links, apps, wholeVariantIds);
  if (!pick || pick.app.imageUrl === (pick.link.pushedImageUrl ?? "")) return null;
  const source = pick.app.imageUrl;
  return {
    sourceUrl: source,
    folder,
    appProductIds: links.filter((l) => apps.get(l.appProductId)?.imageUrl === source).map((l) => l.appProductId),
  };
}

function groupBySite(links: readonly PlanLink[], kind: PlanLink["kind"]): Map<string, PlanLink[]> {
  const out = new Map<string, PlanLink[]>();
  for (const l of links) {
    if (l.kind !== kind) continue;
    out.set(l.siteId, [...(out.get(l.siteId) ?? []), l]);
  }
  return out;
}

function planProducts(input: PlanInput, apps: ReadonlyMap<string, PlanAppProduct>): PublishOp[] {
  const ops: PublishOp[] = [];
  const bySite = new Map<string, { product: SiteProduct; visibility: string }>();
  for (const c of input.catalog) for (const p of c.products) bySite.set(p.id, { product: p, visibility: c.channel_visibility });

  for (const [siteId, links] of groupBySite(input.links, "product")) {
    const found = bySite.get(siteId);
    if (!found) continue; // el producto ya no existe en el sitio
    const { product, visibility } = found;
    const linked = links.filter((l) => apps.has(l.appProductId));
    if (linked.length === 0) continue;
    const body: Record<string, unknown> = {};
    const changes: string[] = [];

    const wanted = linked.flatMap((l) => {
      const cents = apps.get(l.appProductId)!.priceCents;
      return cents > 0 ? [{ variantId: l.siteVariantId, amount: Math.round(cents / 100) }] : [];
    });
    const priceChange = planPrices(product, visibility, wanted);
    if (priceChange) {
      body.prices = priceChange.prices;
      changes.push(...priceChange.changes);
    }

    const shouldBeActive = linked.some((l) => apps.get(l.appProductId)!.isActive);
    const deactivates = !shouldBeActive && isOn(product.active);
    if (shouldBeActive !== isOn(product.active)) {
      body.active = shouldBeActive;
      changes.push(shouldBeActive ? `Mostrar: ${product.name}` : `Ocultar: ${product.name}`);
    }

    const whole = new Set(product.variants.filter((v) => isWhole(v.label)).map((v) => v.id));
    const photo = photoTask(linked, apps, whole, "products");
    if (photo) changes.push(`Foto nueva: ${product.name}`);

    if (changes.length > 0) {
      ops.push({
        kind: "product", siteId, siteName: product.name, body, photo, changes, deactivates,
        appProductIds: linked.map((l) => l.appProductId),
      });
    }
  }
  return ops;
}

function planPromotions(input: PlanInput, apps: ReadonlyMap<string, PlanAppProduct>): PublishOp[] {
  const ops: PublishOp[] = [];
  const promos = new Map(input.promotions.map((p) => [p.id, p]));
  for (const [siteId, links] of groupBySite(input.links, "promotion")) {
    const promo = promos.get(siteId);
    if (!promo) continue;
    const linked = links.filter((l) => apps.has(l.appProductId));
    if (linked.length === 0) continue;
    const body: Record<string, unknown> = {};
    const changes: string[] = [];

    const cents = apps.get(linked[0].appProductId)!.priceCents;
    if (cents > 0) {
      const amount = Math.round(cents / 100);
      if (promo.price !== amount) {
        body.price = amount;
        changes.push(`Promo ${promo.name}: ${formatPesos(promo.price ?? 0)} → ${formatPesos(amount)}`);
      }
    }
    const shouldBeActive = linked.some((l) => apps.get(l.appProductId)!.isActive);
    const deactivates = !shouldBeActive && isOn(promo.active);
    if (shouldBeActive !== isOn(promo.active)) {
      body.active = shouldBeActive;
      changes.push(shouldBeActive ? `Mostrar promo: ${promo.name}` : `Ocultar promo: ${promo.name}`);
    }
    const photo = photoTask(linked, apps, new Set(), "promos");
    if (photo) changes.push(`Foto nueva: promo ${promo.name}`);

    if (changes.length > 0) {
      ops.push({
        kind: "promotion", siteId, siteName: promo.name, body, photo, changes, deactivates,
        appProductIds: linked.map((l) => l.appProductId),
      });
    }
  }
  return ops;
}

/** Si el plan apaga demasiado de golpe (algo anda mal en la app), no se apaga nada y se avisa. */
function applyGuardrail(ops: PublishOp[], activeOnSite: number): PublishPlan {
  const deactivating = ops.filter((o) => o.deactivates).length;
  if (deactivating === 0 || deactivating <= activeOnSite * MAX_DEACTIVATION_RATIO) return { ops, warnings: [] };
  const kept = ops
    .map((o): PublishOp => {
      if (!o.deactivates) return o;
      const { active: _drop, ...body } = o.body;
      void _drop;
      return { ...o, body, deactivates: false, changes: o.changes.filter((c) => !/^Ocultar/.test(c)) };
    })
    .filter((o) => o.changes.length > 0);
  return {
    ops: kept,
    warnings: [
      `Se frenaron ${deactivating} desactivaciones: son más del ${Math.round(MAX_DEACTIVATION_RATIO * 100)} % de los ${activeOnSite} productos activos del sitio. Revisá la app antes de ocultar.`,
    ],
  };
}

export function planPublish(input: PlanInput): PublishPlan {
  const apps = new Map(input.appProducts.map((p) => [p.id, p]));
  const all = [...planProducts(input, apps), ...planPromotions(input, apps)];
  const activeOnSite =
    input.catalog.flatMap((c) => c.products).filter((p) => isOn(p.active)).length + input.promotions.filter((p) => isOn(p.active)).length;
  const plan = applyGuardrail(all, activeOnSite);
  if (!input.onlyAppProductIds) return plan;
  const only = new Set(input.onlyAppProductIds);
  return { ...plan, ops: plan.ops.filter((o) => o.appProductIds.some((id) => only.has(id))) };
}

/** Todas las líneas legibles del plan (para la vista previa). */
export const planLines = (plan: PublishPlan): string[] => plan.ops.flatMap((o) => o.changes);
