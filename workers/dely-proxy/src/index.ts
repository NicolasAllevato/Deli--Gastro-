/**
 * Reenvío de bot-dely.opsyn.app → Worker whatsapp-bot (cuenta "Opsyn Dely").
 * Vive en la cuenta "Opsyn wallet" porque ahí está registrado opsyn.app; no guarda nada ni tiene secretos.
 * El cuerpo se reenvía sin tocar para que la firma HMAC de Meta (X-Hub-Signature-256) siga siendo válida.
 */
const UPSTREAM = "https://whatsapp-bot.opsyn-dely.workers.dev";
/** Solo las rutas del bot: nada más se reenvía (evita usar el proxy para otros destinos). */
const ALLOWED_PATHS = new Set(["/webhook", "/health"]);

export default {
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (!ALLOWED_PATHS.has(url.pathname)) return new Response("Not found", { status: 404 });
    // Host fijo: se copian ruta y query sobre el upstream, nunca se resuelve una URL relativa.
    const target = new URL(UPSTREAM);
    target.pathname = url.pathname;
    target.search = url.search;
    const headers = new Headers(req.headers);
    headers.delete("host");
    return fetch(target, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
      redirect: "manual",
    });
  },
} satisfies ExportedHandler;
