export interface Env {
  /** URL pública de la app Next.js, sin barra final. */
  BASE_URL: string;
  /** Mismo valor que CRON_SECRET en la app. */
  CRON_SECRET: string;
}

const ENDPOINT = "/api/cron/surveys";
const DAILY_SUMMARY_ENDPOINT = "/api/cron/daily-summary";
const SITE_PUBLISH_ENDPOINT = "/api/cron/sitio-publish";
const TIMEOUT_MS = 50_000;

/** Arma la URL de un endpoint; lanza si la variable falta o no es https (el secreto no viaja en claro). */
function endpointUrl(baseUrl: string | undefined, path: string): string {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/.+/.test(base)) {
    throw new Error("BASE_URL no está configurada (URL pública de la app, con https://).");
  }
  return `${base}${path}`;
}

export const surveysUrl = (baseUrl: string | undefined): string => endpointUrl(baseUrl, ENDPOINT);
export const dailySummaryUrl = (baseUrl: string | undefined): string => endpointUrl(baseUrl, DAILY_SUMMARY_ENDPOINT);

export const sitePublishUrl = (baseUrl: string | undefined): string => endpointUrl(baseUrl, SITE_PUBLISH_ENDPOINT);

/** Publica al sitio web los cambios de la app (precios, ocultos y fotos). */
export async function triggerSitePublish(env: Env, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return callApp(env, sitePublishUrl(env.BASE_URL), fetchImpl);
}

/** Llama al endpoint de la app. Lanza ante cualquier respuesta que no sea 2xx para que quede en los logs. */
export async function triggerSurveys(env: Env, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return callApp(env, surveysUrl(env.BASE_URL), fetchImpl);
}

/** Dispara el resumen diario; la app decide si ya pasó la hora de cierre y evita el envío doble. */
export async function triggerDailySummary(env: Env, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  return callApp(env, dailySummaryUrl(env.BASE_URL), fetchImpl);
}

async function callApp(env: Env, url: string, fetchImpl: typeof fetch): Promise<unknown> {
  if (!env.CRON_SECRET) throw new Error("CRON_SECRET no está configurado.");

  const res = await fetchImpl(url, {
    method: "GET",
    headers: { authorization: `Bearer ${env.CRON_SECRET}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`La app respondió ${res.status}: ${text.slice(0, 300)}`);

  try {
    return JSON.parse(text);
  } catch {
    return text.slice(0, 300);
  }
}

/**
 * Worker cron (cada 15 min): dispara el envío de encuestas post-entrega de la app.
 * La app decide qué pedidos corresponden, la ventana horaria y evita los envíos dobles;
 * este Worker solo es el reloj (en Vercel Hobby un cron de 15 min hace fallar el deploy).
 *
 * Deploy: ver README.md de este directorio.
 */
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // Cada tarea va por su lado: si falla una, la otra igual corre y el error queda en los logs.
    const run = (name: string, task: Promise<unknown>) =>
      task.then(
        (result) => console.log(`[encuestas-cron] ${name} ok`, JSON.stringify(result)),
        (error: unknown) => console.error(`[encuestas-cron] ${name} falló`, error instanceof Error ? error.message : error),
      );
    ctx.waitUntil(Promise.all([run("encuestas", triggerSurveys(env)), run("resumen-diario", triggerDailySummary(env)), run("sitio-publish", triggerSitePublish(env))]));
  },
};
