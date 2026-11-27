import { NextRequest, NextResponse } from "next/server";
import { siteLinksApp, sitePublishApp } from "@/lib/data";
import { downloadSitePhoto, PhotoError, sitePhotoFor } from "@/lib/gambeta/photos";
import { gambetaClient, gambetaMessage, guard, loadSite, serverError } from "@/lib/gambeta/server";
import { getUploadsWorkerConfig, uploadViaWorker } from "@/lib/storage/uploads-worker";

interface PhotoOutcome {
  productId: string;
  name: string;
  reason?: string;
}

/**
 * Trae las fotos del sitio para los productos vinculados que todavía no tienen una. Nunca pisa una foto existente.
 * La foto se descarga del sitio y se sube a nuestro bucket (la URL del sitio no está permitida en la CSP de la app).
 */
export async function POST(req: NextRequest) {
  const { denied, actor } = await guard(req, 5);
  if (denied || !actor) return denied;
  const workerConfig = getUploadsWorkerConfig();
  if (!workerConfig) {
    return NextResponse.json({ error: "El servicio de fotos no está configurado en el servidor." }, { status: 500 });
  }
  let site;
  try {
    site = await loadSite(gambetaClient());
  } catch (err) {
    return NextResponse.json({ error: gambetaMessage(err) }, { status: 502 });
  }
  try {
    const [products, links] = await Promise.all([siteLinksApp.products(actor), siteLinksApp.list(actor)]);
    const byId = new Map(products.map((p) => [p.id, p]));
    const copied: PhotoOutcome[] = [];
    const skipped: PhotoOutcome[] = [];
    const failed: PhotoOutcome[] = [];
    const uploadedBySource = new Map<string, string>();

    for (const link of links) {
      const product = byId.get(link.appProductId);
      if (!product) continue; // producto inactivo: no se publica
      const base = { productId: product.id, name: product.name };
      if (product.hasPhoto) {
        skipped.push({ ...base, reason: "Ya tiene foto." });
        continue;
      }
      const source = sitePhotoFor(link, site.catalog, site.promotions);
      if (!source) {
        skipped.push({ ...base, reason: "El producto del sitio no tiene foto." });
        continue;
      }
      try {
        let url = uploadedBySource.get(source);
        if (!url) {
          const photo = await downloadSitePhoto(source);
          url = await uploadViaWorker(workerConfig, photo.bytes, photo.contentType);
          uploadedBySource.set(source, url);
        }
        const saved = await siteLinksApp.setPhotoIfEmpty(actor, product.id, url);
        // La foto nueva de la app es la del sitio: así la publicación no la vuelve a subir.
        if (saved) await sitePublishApp.markPushedImage(actor, product.id, url);
        (saved ? copied : skipped).push(saved ? base : { ...base, reason: "Ya tiene foto." });
      } catch (err) {
        console.error("[admin/sitio] foto", product.id, err instanceof Error ? err.message : err);
        failed.push({ ...base, reason: err instanceof PhotoError ? err.message : "No se pudo subir la foto." });
      }
    }
    return NextResponse.json({ success: true, copied, skipped, failed });
  } catch (err) {
    return serverError("traer fotos", err);
  }
}
