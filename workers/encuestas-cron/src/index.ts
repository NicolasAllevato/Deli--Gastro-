export interface Env {
  /** URL pública de la app Next.js, sin barra final. */
  BASE_URL: string;
  /** Mismo valor que CRON_SECRET en la app. */
  CRON_SECRET: string;
}

const ENDPOINT = "/api/cron/surveys";
const TIMEOUT_MS = 50_000;

/** Arma la URL del endpoint; lanza si la variable falta o no es https (el secreto no viaja en claro). */
export function surveysUrl(baseUrl: string | undefined): string {
  const base = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!/^https:\/\/.+/.test(base)) {
    throw new Error("BASE_URL no está configurada (URL pública de la app, con https://).");
  }
  return `${base}${ENDPOINT}`;
}

/** Llama al endpoint de la app. Lanza ante cualquier respuesta que no sea 2xx para que quede en los logs. */
export async function triggerSurveys(env: Env, fetchImpl: typeof fetch = fetch): Promise<unknown> {
  if (!env.CRON_SECRET) throw new Error("CRON_SECRET no está configurado.");

  const res = await fetchImpl(surveysUrl(env.BASE_URL), {
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
    ctx.waitUntil(
      triggerSurveys(env).then((result) => {
        console.log("[encuestas-cron] ok", JSON.stringify(result));
      }),
    );
  },
};
