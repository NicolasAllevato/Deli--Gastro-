import postgres from "postgres";
import { verifyChallenge } from "./verify.ts";

export interface Env {
  DB: Hyperdrive;
  AI: Ai;
}

const WEBHOOK_PATH = "/webhook";

/** Una conexión por request: Hyperdrive mantiene el pool real del lado de Cloudflare. */
function connect(env: Env) {
  return postgres(env.DB.connectionString, { max: 5, fetch_types: false, prepare: true });
}

async function readSecret(sql: postgres.Sql, key: string): Promise<string | null> {
  const rows = await sql<{ value: string }[]>`select value from public.integration_secrets where key = ${key}`;
  return rows[0]?.value ?? null;
}

/** Salud: confirma que llega a la base por Hyperdrive y cuánto tarda (sin datos sensibles). */
async function health(env: Env): Promise<Response> {
  const sql = connect(env);
  const started = Date.now();
  try {
    await sql`select 1`;
    return Response.json({ ok: true, dbMs: Date.now() - started });
  } catch (error: unknown) {
    console.error("[whatsapp-bot] health", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 503 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function verifyWebhook(url: URL, env: Env): Promise<Response> {
  const sql = connect(env);
  try {
    const challenge = verifyChallenge(url.searchParams, await readSecret(sql, "whatsapp_verify_token"));
    return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") return health(env);
    if (url.pathname === WEBHOOK_PATH && req.method === "GET") return verifyWebhook(url, env);
    // Fase 3: POST /webhook (firma HMAC + cola). Hasta entonces el webhook real sigue en Next.
    if (url.pathname === WEBHOOK_PATH && req.method === "POST") return new Response("Not implemented", { status: 501 });

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
