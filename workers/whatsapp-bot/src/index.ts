import postgres from "postgres";
import { verifyChallenge } from "./verify.ts";
import { handleWebhookEvents } from "./entry.ts";
import { sqlInboundRepo } from "./repo/inbound.ts";
import { parseWebhook } from "../../../src/lib/whatsapp/payload.ts";
import { verifySignature } from "../../../src/lib/whatsapp/signature.ts";
import type { BufferedMessage } from "./batching.ts";
import type { ConversationBuffer, InboundTurn } from "./conversation-buffer.ts";

export { ConversationBuffer } from "./conversation-buffer.ts";

export interface Env {
  DB: Hyperdrive;
  AI: Ai;
  /** Apilador por conversación: un Durable Object por teléfono. */
  BUFFER: DurableObjectNamespace<ConversationBuffer>;
  INBOUND: Queue<InboundTurn>;
}

const WEBHOOK_PATH = "/webhook";
/** Meta manda notificaciones chicas; un cuerpo más grande no es de Meta. */
const MAX_BODY_BYTES = 256 * 1024;
const SECRETS_TTL_MS = 60_000;

interface BotSecrets {
  appSecret: string | null;
  verifyToken: string | null;
  phoneNumberId: string | null;
}

/** Caché por instancia: evita una consulta por mensaje; un cambio en el panel se ve en ≤ 60 s. */
let secretsCache: { value: BotSecrets; at: number } | null = null;

/** Una conexión por request: Hyperdrive mantiene el pool real del lado de Cloudflare. */
function connect(env: Env) {
  return postgres(env.DB.connectionString, { max: 5, fetch_types: false, prepare: true });
}

async function loadSecrets(sql: postgres.Sql): Promise<BotSecrets> {
  if (secretsCache && Date.now() - secretsCache.at < SECRETS_TTL_MS) return secretsCache.value;
  const rows = await sql<{ key: string; value: string }[]>`
    select key, value from public.bot_secrets
    where key in ('whatsapp_app_secret', 'whatsapp_verify_token', 'whatsapp_phone_number_id')`;
  const get = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  const value = {
    appSecret: get("whatsapp_app_secret"),
    verifyToken: get("whatsapp_verify_token"),
    phoneNumberId: get("whatsapp_phone_number_id"),
  };
  secretsCache = { value, at: Date.now() };
  return value;
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
    const challenge = verifyChallenge(url.searchParams, (await loadSecrets(sql)).verifyToken);
    return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Procesa en segundo plano lo que ya respondimos con 200 (Meta no espera). */
async function processEvents(rawBody: string, phoneNumberId: string | null, env: Env): Promise<void> {
  const events = parseWebhook(JSON.parse(rawBody) as unknown);
  if (events.length === 0) return;
  const sql = connect(env);
  try {
    await handleWebhookEvents(events, {
      repo: sqlInboundRepo(sql),
      phoneNumberId,
      buffer: (phone: string, message: BufferedMessage) => env.BUFFER.get(env.BUFFER.idFromName(phone)).add(phone, message),
      log: (message, detail) => console.error(message, detail),
    });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** POST de Meta: firma HMAC del cuerpo crudo → 200 inmediato → guardar y apilar en segundo plano. */
async function receiveWebhook(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  const sql = connect(env);
  let secrets: BotSecrets;
  try {
    secrets = await loadSecrets(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
  // Sin App Secret configurado se rechaza todo (falla cerrado).
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"), secrets.appSecret ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  ctx.waitUntil(
    processEvents(rawBody, secrets.phoneNumberId, env).catch((error: unknown) =>
      console.error("[whatsapp-bot] webhook", error instanceof Error ? error.message : error),
    ),
  );
  return new Response("OK");
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") return health(env);
    if (url.pathname === WEBHOOK_PATH && req.method === "GET") return verifyWebhook(url, env);
    if (url.pathname === WEBHOOK_PATH && req.method === "POST") return receiveWebhook(req, env, ctx);

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
