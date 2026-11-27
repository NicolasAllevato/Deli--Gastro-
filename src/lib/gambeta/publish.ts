/**
 * Ejecutor de la publicación al sitio web: lee la app (store) y el sitio (GET), arma el plan y lo ejecuta en serie.
 * Todo es inyectable (cliente, store, fetch, reloj) para probarlo sin red. Un error en un ítem no corta el resto.
 */
import type { PublishLink, PublishStore, PublishTrigger, PushResult } from "../data/site-publish.ts";
import { GambetaError, type GambetaClient } from "./client.ts";
import { downloadAppPhoto, PhotoError } from "./photos.ts";
import { planPublish, planLines, type PublishOp, type PublishPlan } from "./publish-plan.ts";
import type { SiteCategory, SitePromotion } from "./schemas.ts";

export const MAX_OPS_PER_RUN = 60;
/** Una corrida sin terminar de hace menos de esto se considera en curso. */
export const OVERLAP_WINDOW_MS = 5 * 60_000;
const MAX_ERROR_LENGTH = 200;
const MAX_ERRORS_IN_SUMMARY = 5;

export interface PublishDeps {
  store: PublishStore;
  client: GambetaClient;
  /** Para descargar la foto de nuestro bucket. */
  fetchImpl?: typeof fetch;
  now?: () => Date;
  newId?: () => string;
  /** `R2_PUBLIC_BASE_URL`: solo se mandan fotos de ese host. */
  publicBaseUrl: string | null | undefined;
  maxOps?: number;
}

export interface PublishOptions {
  trigger: PublishTrigger;
  onlyAppProductIds?: readonly string[];
}

export type PublishOutcome =
  | { status: "sin_clave" | "ocupado" | "sin_vinculos" }
  | { status: "ok" | "con_errores" | "error"; runId: string; summary: PublishSummary };

export interface PublishSummary {
  ops: number;
  ok: number;
  errors: number;
  /** Operaciones que quedaron para la próxima corrida por el tope. */
  pending: number;
  warnings: string[];
  errorList: Array<{ name: string; message: string }>;
  failure?: string;
}

/** Mensaje corto y sin datos sensibles (los errores del cliente ya vienen sin la clave). */
export function shortError(err: unknown): string {
  const raw =
    err instanceof GambetaError || err instanceof PhotoError ? err.message : err instanceof Error ? "Error inesperado." : "Error inesperado.";
  return raw.slice(0, MAX_ERROR_LENGTH);
}

function extensionFor(contentType: string): string {
  return contentType === "image/png" ? "png" : contentType === "image/webp" ? "webp" : "jpg";
}

/** Descarga la foto de la app y la sube al sitio (`POST /media`). Devuelve la URL del sitio. */
export async function uploadAppPhoto(
  deps: Pick<PublishDeps, "client" | "fetchImpl" | "publicBaseUrl">,
  sourceUrl: string,
  folder: "products" | "promos",
): Promise<string> {
  const photo = await downloadAppPhoto(sourceUrl, deps.publicBaseUrl, deps.fetchImpl);
  const uploaded = await deps.client.uploadMedia(
    { bytes: photo.bytes, contentType: photo.contentType, filename: `foto.${extensionFor(photo.contentType)}` },
    folder,
  );
  return uploaded.url;
}

async function loadState(deps: PublishDeps, opts: PublishOptions): Promise<{ plan: PublishPlan; links: PublishLink[] }> {
  const [appProducts, links, catalog, promotions] = await Promise.all([
    deps.store.listAppProducts(),
    deps.store.listLinks(),
    deps.client.getCatalog(),
    deps.client.getPromotions(),
  ]);
  return { plan: buildPlan(appProducts, links, catalog, promotions, opts), links };
}

function buildPlan(
  appProducts: Parameters<typeof planPublish>[0]["appProducts"],
  links: readonly PublishLink[],
  catalog: readonly SiteCategory[],
  promotions: readonly SitePromotion[],
  opts: Pick<PublishOptions, "onlyAppProductIds">,
): PublishPlan {
  return planPublish({ appProducts, links, catalog, promotions, onlyAppProductIds: opts.onlyAppProductIds });
}

/** Vista previa: el plan sin ejecutarlo. */
export async function previewPublish(deps: PublishDeps): Promise<PublishPlan & { lines: string[] }> {
  const { plan } = await loadState(deps, { trigger: "manual" });
  return { ...plan, lines: planLines(plan) };
}

interface OpResult {
  pushes: PushResult[];
  error: string | null;
}

async function executeOp(deps: PublishDeps, op: PublishOp, nowIso: string): Promise<OpResult> {
  const body: Record<string, unknown> = { ...op.body };
  let photoError: string | null = null;
  let uploadedFrom: string | undefined;
  if (op.photo) {
    try {
      body.image_url = await uploadAppPhoto(deps, op.photo.sourceUrl, op.photo.folder);
      uploadedFrom = op.photo.sourceUrl;
    } catch (err) {
      photoError = `Foto: ${shortError(err)}`;
    }
  }
  const finish = (error: string | null, pushed: boolean): OpResult => ({
    error,
    pushes: op.appProductIds.map((id) => ({
      appProductId: id,
      pushedAt: pushed ? nowIso : null,
      error,
      ...(pushed && uploadedFrom && op.photo?.appProductIds.includes(id) ? { pushedImageUrl: uploadedFrom } : {}),
    })),
  });
  if (Object.keys(body).length === 0) return finish(photoError, false);
  try {
    if (op.kind === "product") await deps.client.putProduct(op.siteId, body);
    else await deps.client.putPromotion(op.siteId, body);
  } catch (err) {
    return finish(shortError(err), false);
  }
  return finish(photoError, true);
}

export async function runPublish(deps: PublishDeps, opts: PublishOptions): Promise<PublishOutcome> {
  if (!deps.client.hasKey) return { status: "sin_clave" };
  const now = deps.now ?? (() => new Date());
  const { store } = deps;
  if (await store.hasRunningSince(new Date(now().getTime() - OVERLAP_WINDOW_MS).toISOString())) return { status: "ocupado" };
  if (opts.onlyAppProductIds) {
    const mine = new Set(opts.onlyAppProductIds);
    if (!(await store.listLinks()).some((l) => mine.has(l.appProductId))) return { status: "sin_vinculos" };
  }

  const runId = (deps.newId ?? (() => crypto.randomUUID()))();
  await store.startRun(runId, opts.trigger, now().toISOString());
  const summary: PublishSummary = { ops: 0, ok: 0, errors: 0, pending: 0, warnings: [], errorList: [] };
  try {
    const { plan, links } = await loadState(deps, opts);
    const limit = deps.maxOps ?? MAX_OPS_PER_RUN;
    const batch = plan.ops.slice(0, limit);
    summary.ops = batch.length;
    summary.pending = plan.ops.length - batch.length;
    summary.warnings = plan.warnings;

    const touched = new Set<string>();
    for (const op of batch) {
      op.appProductIds.forEach((id) => touched.add(id));
      const result = await executeOp(deps, op, now().toISOString());
      try {
        await store.recordPushes(result.pushes);
      } catch (err) {
        console.error("[sitio-publish] no se pudo guardar el resultado", err instanceof Error ? err.message : err);
      }
      if (result.error) {
        summary.errors++;
        if (summary.errorList.length < MAX_ERRORS_IN_SUMMARY) summary.errorList.push({ name: op.siteName, message: result.error });
      } else {
        summary.ok++;
      }
    }
    // Lo que tenía un error viejo y hoy ya está al día deja de mostrarlo (solo en corridas completas).
    if (!opts.onlyAppProductIds && summary.pending === 0) {
      await store.clearErrors(links.filter((l) => l.lastPushError && !touched.has(l.appProductId)).map((l) => l.appProductId));
    }
  } catch (err) {
    summary.failure = shortError(err);
  }
  const status = summary.failure ? "error" : summary.errors > 0 ? "con_errores" : "ok";
  await store.finishRun(runId, status === "ok", { ...summary }, now().toISOString());
  return { status, runId, summary };
}
