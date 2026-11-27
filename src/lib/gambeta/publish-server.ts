/** Armado de dependencias reales del ejecutor (D1, clave del sitio, bucket público) y disparo en segundo plano. */
import { sitePublishApp, systemActor, type Actor } from "@/lib/data";
import { createGambetaClient, readGambetaApiKey } from "./client";
import { runPublish, type PublishDeps, type PublishOutcome, type PublishOptions } from "./publish";

export async function publishDeps(actor: Actor): Promise<PublishDeps> {
  return {
    store: await sitePublishApp.store(actor),
    client: createGambetaClient({ apiKey: readGambetaApiKey() }),
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL,
  };
}

export async function runPublishAs(actor: Actor, opts: PublishOptions): Promise<PublishOutcome> {
  return runPublish(await publishDeps(actor), opts);
}

/** Deja trabajo corriendo después de la respuesta (Workers `waitUntil`); fuera de Cloudflare no demora nada. */
async function inBackground(task: Promise<unknown>): Promise<void> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    getCloudflareContext().ctx.waitUntil(task);
  } catch {
    // Sin contexto de Cloudflare (dev/tests): la promesa sigue sola; su error ya está capturado.
  }
}

/**
 * Un producto cambió en la app: si está vinculado al sitio, publica sus cambios sin demorar la respuesta.
 * Nunca lanza: un fallo queda en el log y la próxima corrida automática lo reintenta.
 */
export function publishProductChange(appProductId: string): void {
  if (!readGambetaApiKey()) return;
  const task = runPublishAs(systemActor("publicación al sitio por cambio en la app"), { trigger: "cambio", onlyAppProductIds: [appProductId] })
    .catch((err: unknown) => console.error("[sitio-publish] cambio", err instanceof Error ? err.message : err));
  void inBackground(task);
}
