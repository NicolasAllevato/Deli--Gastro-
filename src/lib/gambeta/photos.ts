/**
 * Fotos del sitio web → nuestro bucket. La URL del sitio vive en otro host de R2 que no está en la CSP ni en los
 * remotePatterns de next/image, así que no se usa directo: se descarga (solo https, host exacto, jpg/png/webp, ≤5 MB)
 * y se vuelve a subir por el mismo mecanismo que `/api/upload`.
 */
import type { SiteCategory, SitePromotion } from "./schemas.ts";
import type { SiteLink } from "../data/site-links.ts";

export const SITE_PHOTO_HOST = "pub-8442be6f8cd2447fa1e48235f4be6411.r2.dev";
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const DOWNLOAD_TIMEOUT_MS = 15_000;

export class PhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PhotoError";
  }
}

/** Solo https y el host exacto del sitio (sin puerto ni credenciales). */
export function isAllowedSitePhotoUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && u.hostname === SITE_PHOTO_HOST && u.port === "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

/** URL de la foto del sitio para un vínculo (producto o promoción), o null si no tiene. */
export function sitePhotoFor(link: Pick<SiteLink, "kind" | "siteId">, catalog: readonly SiteCategory[], promos: readonly SitePromotion[]): string | null {
  if (link.kind === "promotion") {
    return promos.find((p) => p.id === link.siteId)?.image_url?.trim() || null;
  }
  for (const c of catalog) {
    const p = c.products.find((x) => x.id === link.siteId);
    if (p) return p.image_url?.trim() || null;
  }
  return null;
}

export interface DownloadedPhoto {
  bytes: ArrayBuffer;
  contentType: (typeof ALLOWED_TYPES)[number];
}

/** Solo https y el host de nuestro bucket público (`R2_PUBLIC_BASE_URL`), sin puerto ni credenciales. */
export function isAllowedAppPhotoUrl(raw: string, publicBaseUrl: string | null | undefined): boolean {
  if (!publicBaseUrl) return false;
  try {
    const base = new URL(publicBaseUrl);
    const u = new URL(raw);
    return base.protocol === "https:" && u.protocol === "https:" && u.hostname === base.hostname && u.port === "" && u.username === "" && u.password === "";
  } catch {
    return false;
  }
}

export async function downloadSitePhoto(url: string, fetchImpl: typeof fetch = fetch): Promise<DownloadedPhoto> {
  if (!isAllowedSitePhotoUrl(url)) throw new PhotoError("La foto no viene del sitio de la pizzería.");
  return downloadPhoto(url, fetchImpl);
}

/** Descarga una foto de nuestro bucket para mandarla al sitio. */
export async function downloadAppPhoto(url: string, publicBaseUrl: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<DownloadedPhoto> {
  if (!isAllowedAppPhotoUrl(url, publicBaseUrl)) throw new PhotoError("La foto no está en el almacenamiento de la app.");
  return downloadPhoto(url, fetchImpl);
}

async function downloadPhoto(url: string, fetchImpl: typeof fetch): Promise<DownloadedPhoto> {
  let res: Response;
  try {
    res = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
  } catch {
    throw new PhotoError("No se pudo descargar la foto del sitio.");
  }
  if (!res.ok) throw new PhotoError(`El sitio respondió ${res.status} al pedir la foto.`);
  const contentType = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!(ALLOWED_TYPES as readonly string[]).includes(contentType)) throw new PhotoError("La foto no es JPG, PNG ni WEBP.");
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_PHOTO_BYTES) throw new PhotoError("La foto supera los 5 MB.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength === 0) throw new PhotoError("La foto llegó vacía.");
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw new PhotoError("La foto supera los 5 MB.");
  return { bytes, contentType: contentType as DownloadedPhoto["contentType"] };
}
