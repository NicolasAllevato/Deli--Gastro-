import { syncCatalog } from "./catalog-sync";
import { syncCustomers, syncSales } from "./sales-sync.ts";
import { parseSalesRange } from "./sales.ts";
import { claimOrder, listRetryable, loadMaps, markFailed, markSent, MAX_ATTEMPTS, type DbEnv } from "./db";
import { createFudoOrder, FudoError, listFudoCategories, listFudoProducts, type FudoEnv } from "./fudo";
import { buildFudoOrder, parseFudoWebhook } from "./payload";
import { hmacHex, verifyHmacHex } from "./signature";

export interface Env extends FudoEnv, DbEnv {
  APP_URL: string;
  /** Compartido con la app (FUDO_GATEWAY_SECRET en Vercel): firma x-gateway-signature en los dos sentidos. */
  FUDO_GATEWAY_SECRET: string;
  /** "1" activa el sync automático del catálogo en el cron (cada 15 min). El botón del admin funciona siempre. */
  CATALOG_CRON?: string;
  /** "1" importa las ventas de delivery y take away de Fudo en cada corrida del cron (cada 5 min). */
  SALES_CRON?: string;
  /** "1" importa los clientes de Fudo una vez por hora. */
  CUSTOMERS_CRON?: string;
  /** "1" para loguear el cuerpo completo del webhook (trae datos del cliente). Solo mientras se ajusta el parser. */
  DEBUG_WEBHOOK_BODY?: string;
}

const SIGNATURE_HEADER = "x-gateway-signature";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

type SyncResult = "sent" | "skipped" | "failed" | "busy";

/** Manda un pedido a Fudo. Idempotente: un pedido ya enviado o tomado por otro proceso devuelve `busy`. */
async function syncOrder(env: Env, orderId: string): Promise<SyncResult> {
  const claimed = await claimOrder(env, orderId);
  if (!claimed) return "busy";

  const built = buildFudoOrder(claimed.order, await loadMaps(env));
  if (!built.ok) {
    await markFailed(env, orderId, built.reason, true);
    return "skipped";
  }
  try {
    await markSent(env, orderId, await createFudoOrder(env, built.body));
    return "sent";
  } catch (e) {
    const permanent = e instanceof FudoError && e.permanent;
    await markFailed(env, orderId, errorMessage(e), permanent || claimed.attempts >= MAX_ATTEMPTS);
    return permanent ? "skipped" : "failed";
  }
}

async function handleSync(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifyHmacHex(raw, request.headers.get(SIGNATURE_HEADER), env.FUDO_GATEWAY_SECRET))) {
    return json({ error: "Firma inválida." }, 401);
  }
  let orderId: unknown;
  try {
    orderId = (JSON.parse(raw) as { orderId?: unknown }).orderId;
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  if (typeof orderId !== "string" || !/^[0-9a-f-]{36}$/i.test(orderId)) return json({ error: "orderId inválido." }, 400);
  return json({ result: await syncOrder(env, orderId) });
}

/** Webhook de Fudo: se valida la firma con el clientSecret y la app aplica el estado. */
async function handleWebhook(request: Request, env: Env): Promise<Response> {
  const raw = await request.text();
  if (!(await verifyHmacHex(raw, request.headers.get("fudo-signature"), env.FUDO_CLIENT_SECRET))) {
    return json({ error: "Firma inválida." }, 401);
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const parsed = parseFudoWebhook(body, request.headers.get("fudo-event"));
  // El cuerpo puede traer nombre, teléfono y dirección del cliente: por defecto solo se loguean las claves.
  const keys = body && typeof body === "object" ? Object.keys(body) : [];
  const logged = env.DEBUG_WEBHOOK_BODY === "1" ? { parsed, body } : { parsed, keys };
  console.log("[fudo.webhook]", JSON.stringify(logged).slice(0, 2000));
  if (!parsed.event || (parsed.fudoOrderId === null && parsed.externalId === null)) {
    return json({ received: true, ignored: "formato no reconocido" });
  }

  const forward = JSON.stringify({
    event: parsed.event,
    ...(parsed.externalId ? { orderId: parsed.externalId } : {}),
    ...(parsed.fudoOrderId !== null ? { fudoOrderId: parsed.fudoOrderId } : {}),
  });
  const res = await fetch(`${env.APP_URL}/api/integrations/fudo/status`, {
    method: "POST",
    headers: { "content-type": "application/json", [SIGNATURE_HEADER]: await hmacHex(forward, env.FUDO_GATEWAY_SECRET) },
    body: forward,
  });
  // 5xx de la app → 502 para que Fudo reintente; el resto (incluido 400 por evento desconocido) se da por recibido.
  if (res.status >= 500) return json({ error: "La app no pudo aplicar el estado." }, 502);
  return json({ received: true, app: res.status });
}

/** Catálogo de Fudo para la pantalla de mapeo. La app firma el path (`/products` o `/product-categories`). */
async function handleCatalog(request: Request, env: Env, path: "/products" | "/product-categories"): Promise<Response> {
  if (!(await verifyHmacHex(path, request.headers.get(SIGNATURE_HEADER), env.FUDO_GATEWAY_SECRET))) {
    return json({ error: "Firma inválida." }, 401);
  }
  try {
    return json(path === "/products" ? await listFudoProducts(env) : await listFudoCategories(env));
  } catch (e) {
    return json({ error: errorMessage(e) }, 502);
  }
}

/** Sincroniza el catálogo de Fudo con la app a pedido (la app firma el path `/catalog-sync`). */
async function handleCatalogSync(request: Request, env: Env): Promise<Response> {
  if (!(await verifyHmacHex("/catalog-sync", request.headers.get(SIGNATURE_HEADER), env.FUDO_GATEWAY_SECRET))) {
    return json({ error: "Firma inválida." }, 401);
  }
  try {
    // `?dry=1`: solo calcula el plan (no escribe). La firma cubre el path sin la query.
    const dryRun = new URL(request.url).searchParams.get("dry") === "1";
    return json({ result: await syncCatalog(env, dryRun) });
  } catch (e) {
    return json({ error: errorMessage(e) }, 502);
  }
}

type SignedJob = "/catalog-sync" | "/sales-sync" | "/customers-sync";

/** Sync a pedido de ventas o clientes (la app firma el path). `?dry=1` solo calcula. */
async function handleSignedSync(request: Request, env: Env, path: SignedJob, run: (dry: boolean) => Promise<unknown>): Promise<Response> {
  if (!(await verifyHmacHex(path, request.headers.get(SIGNATURE_HEADER), env.FUDO_GATEWAY_SECRET))) {
    return json({ error: "Firma inválida." }, 401);
  }
  try {
    return json({ result: await run(new URL(request.url).searchParams.get("dry") === "1") });
  } catch (e) {
    return json({ error: errorMessage(e) }, 502);
  }
}

/** El catálogo se sincroniza cada 15 min; el cron corre cada 5 para los reintentos de pedidos. */
const CATALOG_SYNC_EVERY_MINUTES = 15;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/catalog-sync") return handleCatalogSync(request, env);
    if (request.method === "POST" && pathname === "/sales-sync") return handleSignedSync(request, env, "/sales-sync", (dry) => syncSales(env, dry, parseSalesRange(new URL(request.url).searchParams)));
    if (request.method === "POST" && pathname === "/customers-sync") return handleSignedSync(request, env, "/customers-sync", (dry) => syncCustomers(env, dry));
    if (request.method === "POST" && pathname === "/sync") return handleSync(request, env);
    if (request.method === "POST" && pathname === "/webhook") return handleWebhook(request, env);
    if (request.method === "GET" && (pathname === "/products" || pathname === "/product-categories")) {
      return handleCatalog(request, env, pathname);
    }
    if (request.method === "GET" && pathname === "/health") return json({ ok: true });
    return json({ error: "No encontrado." }, 404);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      (async () => {
        for (const id of await listRetryable(env)) {
          try {
            await syncOrder(env, id);
          } catch (e) {
            console.error("[fudo.cron]", id, errorMessage(e));
          }
        }
        const minute = new Date(controller.scheduledTime).getUTCMinutes();
        if (env.SALES_CRON === "1") {
          try {
            await syncSales(env);
          } catch (e) {
            console.error("[fudo.sales]", errorMessage(e));
          }
        }
        if (env.CUSTOMERS_CRON === "1" && minute === 0) {
          try {
            await syncCustomers(env);
          } catch (e) {
            console.error("[fudo.customers]", errorMessage(e));
          }
        }
        if (env.CATALOG_CRON === "1" && minute % CATALOG_SYNC_EVERY_MINUTES === 0) {
          try {
            await syncCatalog(env);
          } catch (e) {
            console.error("[fudo.catalog]", errorMessage(e));
          }
        }
      })(),
    );
  },
} satisfies ExportedHandler<Env>;
