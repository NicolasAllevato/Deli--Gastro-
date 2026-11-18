import postgres from "postgres";
import { verifyChallenge } from "./verify.ts";
import { handleWebhookEvents } from "./entry.ts";
import { sqlInboundRepo } from "./repo/inbound.ts";
import { parseWebhook } from "../../../src/lib/whatsapp/payload.ts";
import { parseCoexistence } from "../../../src/lib/whatsapp/coexistence.ts";
import { verifySignature } from "../../../src/lib/whatsapp/signature.ts";
import { processTurn } from "./bot/turn.ts";
import { createOrdersClient } from "./orders/client.ts";
import { audioTranscriber, whatsappClient } from "./bot/channels.ts";
import { sqlBotRepo } from "./repo/bot.ts";
import type { RunModel } from "./ai/models.ts";
import { openAiRunModel, routedRunModel } from "./ai/openai.ts";
import type { BufferedMessage } from "./batching.ts";
import type { ConversationBuffer, InboundTurn } from "./conversation-buffer.ts";
import { mirrorBotRepo, mirrorInboundRepo } from "./repo/d1-mirror.ts";
import { sqlMirrorReader } from "./repo/d1-mirror-sql.ts";
import { d1BotRepo, d1InboundRepo } from "./repo/d1.ts";
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";
import { loadD1BotSecrets, type BotSecrets } from "./secrets-d1.ts";
import { safeError, workerLog } from "./privacy.ts";
import { d1Ledger, handleDeadTurn, onceSend, turnKey } from "./turn-ledger.ts";
import { REPLIES } from "./bot/prompts.ts";
import { openAiJudge, runNightlyLearning } from "./learning/nightly.ts";

export { ConversationBuffer } from "./conversation-buffer.ts";

export interface Env {
  DB: Hyperdrive;
  AI: Ai;
  /** Service binding al Worker de la app (opsyn-dely) para /api/internal/bot/*. */
  APP?: Fetcher;
  /** Apilador por conversación: un Durable Object por teléfono. */
  BUFFER: DurableObjectNamespace<ConversationBuffer>;
  INBOUND: Queue<InboundTurn>;
  /** URL pública de la app (links permitidos en las respuestas del bot). */
  APP_URL: string;
  /** Migración a D1: "dual" | "d1" copia a D1 lo que el bot escribe en Supabase (default: no copia). */
  DATA_BACKEND?: string;
  /** Base D1 `deli-gastro` (el binding DB es Hyperdrive). */
  D1?: D1Database;
  /** Con DATA_BACKEND=d1, los secretos de Meta salen de Worker secrets (no de Supabase). */
  WHATSAPP_APP_SECRET?: string;
  WHATSAPP_VERIFY_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_ACCESS_TOKEN?: string;
  /** Clave AES-GCM (32 bytes base64) para leer `integration_settings` de D1; la misma que en opsyn-dely. */
  SETTINGS_ENC_KEY?: string;
  /** Secret (wrangler secret put BOT_INTERNAL_SECRET, >= 32 caracteres, igual al de Vercel). Sin él los pedidos quedan apagados. */
  BOT_INTERNAL_SECRET?: string;
  /** Secret (wrangler secret put OPENAI_API_KEY). Clasificador y respondedor (gpt-4o-mini) y aprendizaje nocturno; sin él el bot usa Workers AI. */
  OPENAI_API_KEY?: string;
  /** Bucket privado de fotos de reclamos (deli-gastro-reclamos). Sin él las fotos no se guardan; el reclamo sí. */
  RECLAMOS?: R2Bucket;
}

const WEBHOOK_PATH = "/webhook";
/** Meta manda notificaciones chicas; un cuerpo más grande no es de Meta. */
const MAX_BODY_BYTES = 256 * 1024;
const SECRETS_TTL_MS = 60_000;


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
    where key in ('whatsapp_app_secret', 'whatsapp_verify_token', 'whatsapp_phone_number_id', 'whatsapp_access_token')`;
  const get = (key: string) => rows.find((r) => r.key === key)?.value ?? null;
  const value = {
    appSecret: get("whatsapp_app_secret"),
    verifyToken: get("whatsapp_verify_token"),
    phoneNumberId: get("whatsapp_phone_number_id"),
    accessToken: get("whatsapp_access_token"),
  };
  secretsCache = { value, at: Date.now() };
  return value;
}

/**
 * Etapa 2 del corte: con DATA_BACKEND=d1 el bot usa D1 (binding D1) y toma los secretos de Meta de
 * Worker secrets (WHATSAPP_*), sin Hyperdrive ni la vista bot_secrets de Supabase.
 */
function isD1(env: Env): env is Env & { D1: D1Database } {
  return env.DATA_BACKEND?.trim().toLowerCase() === "d1";
}

function d1Db(env: Env): SqlDatabase {
  if (!env.D1) throw new Error("DATA_BACKEND=d1 sin binding D1");
  return env.D1 as unknown as SqlDatabase;
}


/** Secretos del bot: D1 cifrado (respaldo: Worker secrets) en d1; la vista de Supabase en los otros modos. */
async function botSecrets(env: Env): Promise<BotSecrets> {
  if (isD1(env)) return loadD1BotSecrets(d1Db(env), env);
  const sql = connect(env);
  try {
    return await loadSecrets(sql);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/** Salud: confirma que llega a la base y cuánto tarda (sin datos sensibles). */
async function health(env: Env): Promise<Response> {
  if (isD1(env)) {
    const started = Date.now();
    try {
      await d1Db(env).prepare("SELECT bot_paused_until FROM wa_conversations LIMIT 0").all();
      return Response.json({ ok: true, schema: true, dbMs: Date.now() - started, backend: "d1" });
    } catch (error: unknown) {
      console.error("[whatsapp-bot] health d1", error instanceof Error ? error.message : error);
      return Response.json({ ok: false }, { status: 503 });
    }
  }
  const sql = connect(env);
  const started = Date.now();
  try {
    await sql`select 1`;
    const dbMs = Date.now() - started;
    // La migración 021 tiene que estar aplicada antes que este Worker: sus consultas leen esta columna.
    try {
      await sql`select bot_paused_until from public.wa_conversations limit 0`;
    } catch (error: unknown) {
      console.error("[whatsapp-bot] health: falta wa_conversations.bot_paused_until (migración 021)", error instanceof Error ? error.message : error);
      return Response.json({ ok: false, schema: false, dbMs }, { status: 503 });
    }
    return Response.json({ ok: true, schema: true, dbMs });
  } catch (error: unknown) {
    console.error("[whatsapp-bot] health", error instanceof Error ? error.message : error);
    return Response.json({ ok: false }, { status: 503 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function verifyWebhook(url: URL, env: Env): Promise<Response> {
  const challenge = verifyChallenge(url.searchParams, (await botSecrets(env)).verifyToken);
  return challenge === null ? new Response("Forbidden", { status: 403 }) : new Response(challenge);
}

/** Procesa en segundo plano lo que ya respondimos con 200 (Meta no espera). */
async function processEvents(rawBody: string, phoneNumberId: string | null, env: Env): Promise<void> {
  const payload = JSON.parse(rawBody) as unknown;
  const events = [...parseCoexistence(payload), ...parseWebhook(payload)];
  if (events.length === 0) return;
  const log = workerLog;
  if (isD1(env)) {
    await handleWebhookEvents(events, {
      repo: d1InboundRepo(d1Db(env), log),
      phoneNumberId,
      buffer: (phone: string, message: BufferedMessage) => env.BUFFER.get(env.BUFFER.idFromName(phone)).add(phone, message),
      log,
    });
    return;
  }
  const sql = connect(env);
  try {
    await handleWebhookEvents(events, {
      repo: mirrorInboundRepo(sqlInboundRepo(sql, workerLog), env, sqlMirrorReader(sql)),
      phoneNumberId,
      buffer: (phone: string, message: BufferedMessage) => env.BUFFER.get(env.BUFFER.idFromName(phone)).add(phone, message),
      log: workerLog,
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

  const secrets = await botSecrets(env);
  // Sin App Secret configurado se rechaza todo (falla cerrado).
  if (!verifySignature(rawBody, req.headers.get("x-hub-signature-256"), secrets.appSecret ?? "")) {
    return new Response("Unauthorized", { status: 401 });
  }

  ctx.waitUntil(
    processEvents(rawBody, secrets.phoneNumberId, env).catch((error: unknown) =>
      console.error("[whatsapp-bot] webhook", safeError(error)),
    ),
  );
  return new Response("OK");
}

/** Cliente de pedidos solo si hay un secreto utilizable (>= 32 caracteres, igual que exige la app). */
function ordersClientFor(env: Env) {
  const secret = env.BOT_INTERNAL_SECRET?.trim() ?? "";
  if (secret.length < 32) return undefined;
  // Con service binding la llamada va directo al Worker de la app: un Worker no puede pedirle por internet a otro
  // Worker de la misma zona (la-gambeta.com) y fallaba con `network`. Sin binding (tests, otros entornos) usa fetch.
  const fetchImpl = env.APP ? ((input: RequestInfo | URL, init?: RequestInit) => env.APP!.fetch(input, init)) as typeof fetch : undefined;
  return createOrdersClient({ baseUrl: env.APP_URL, secret, log: workerLog, fetchImpl });
}

/** Fotos de reclamos: hasta 5 MB, solo imágenes. Clave `reclamos/<ticket>/<uuid>.<ext>` en el bucket privado. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function photoStore(bucket: R2Bucket, wa: ReturnType<typeof whatsappClient>) {
  return async (ticketId: string, mediaId: string): Promise<string | null> => {
    const media = await wa.downloadMedia(mediaId, MAX_PHOTO_BYTES);
    const type = media.mimeType.split(";")[0].trim().toLowerCase();
    const ext = PHOTO_EXT[type];
    if (!ext) return null;
    const key = `reclamos/${ticketId}/${crypto.randomUUID()}.${ext}`;
    await bucket.put(key, media.data, { httpMetadata: { contentType: type } });
    return key;
  };
}

/** Consumidor de `wa-inbound` (fase 4): un turno agrupado → una respuesta. */
async function consumeTurns(batch: MessageBatch<InboundTurn>, env: Env): Promise<void> {
  // d1: sin Hyperdrive (etapa 2 del corte).
  const sql = isD1(env) ? null : connect(env);
  try {
    const secrets = sql ? await loadSecrets(sql) : await loadD1BotSecrets(d1Db(env), env);
    if (!secrets.accessToken || !secrets.phoneNumberId) {
      console.error("[whatsapp-bot] faltan el token o el phone number id: los turnos quedan para reintentar");
      batch.retryAll({ delaySeconds: 60 });
      return;
    }
    const wa = whatsappClient(secrets.accessToken, secrets.phoneNumberId);
    const workersAi: RunModel = (model, input) => env.AI.run(model as Parameters<Ai["run"]>[0], input as never);
    // OpenAI primero; si falla o falta la clave, cada llamada cae sola al modelo de respaldo de Workers AI (runWithFallback).
    const run = routedRunModel(workersAi, openAiRunModel(env.OPENAI_API_KEY?.trim() ?? ""));
    const deps = {
      repo: sql
        ? mirrorBotRepo(sqlBotRepo(sql, workerLog), env, sqlMirrorReader(sql))
        : d1BotRepo(d1Db(env), workerLog),
      run,
      transcribe: audioTranscriber(env.AI, wa),
      send: (phone: string, text: string) => wa.sendText(phone, text),
      sendDocument: (phone: string, url: string, filename: string, caption?: string) => wa.sendDocument(phone, url, filename, caption),
      appUrl: env.APP_URL,
      orders: ordersClientFor(env),
      storePhoto: env.RECLAMOS ? photoStore(env.RECLAMOS, wa) : undefined,
      log: workerLog,
    };
    // En orden: dos turnos de la misma conversación nunca se responden a la vez dentro del lote.
    const ledger = sql ? null : d1Ledger(d1Db(env));
    for (const message of batch.messages) {
      try {
        // Con D1, cada respuesta del turno sale una sola vez aunque la cola lo reintente.
        const send = ledger ? onceSend(deps.send, ledger, turnKey(message.body)) : deps.send;
        // La carta en PDF lleva su propio registro (clave aparte) para no mandarse dos veces si la cola reintenta.
        const sendDocument = ledger
          ? (phone: string, url: string, filename: string, caption?: string) =>
              onceSend((p) => deps.sendDocument(p, url, filename, caption), ledger, `${turnKey(message.body)}:doc`)(phone, url)
          : deps.sendDocument;
        const outcome = await processTurn(message.body, { ...deps, send, sendDocument });
        console.log("[whatsapp-bot] turno", outcome);
        message.ack();
      } catch (error: unknown) {
        console.error("[whatsapp-bot] turno con error", safeError(error));
        message.retry({ delaySeconds: 10 });
      }
    }
  } finally {
    if (sql) await sql.end({ timeout: 1 });
  }
}

const DEAD_LETTER_QUEUE = "wa-inbound-dlq";

/** Turnos que agotaron los reintentos: aviso único al cliente + takeover (el local lo ve en el panel). */
async function consumeDeadTurns(batch: MessageBatch<InboundTurn>, env: Env): Promise<void> {
  if (!isD1(env)) {
    workerLog("[whatsapp-bot] DLQ sin D1: turnos descartados", { count: batch.messages.length });
    batch.ackAll();
    return;
  }
  const db = d1Db(env);
  const secrets = await loadD1BotSecrets(db, env);
  if (!secrets.accessToken || !secrets.phoneNumberId) {
    batch.retryAll({ delaySeconds: 300 });
    return;
  }
  const wa = whatsappClient(secrets.accessToken, secrets.phoneNumberId);
  const deps = { repo: d1BotRepo(db, workerLog), ledger: d1Ledger(db), send: (p: string, t: string) => wa.sendText(p, t), failureText: REPLIES.failure, log: workerLog };
  for (const message of batch.messages) {
    try {
      console.log("[whatsapp-bot] DLQ", await handleDeadTurn(message.body, deps));
      message.ack();
    } catch (error: unknown) {
      console.error("[whatsapp-bot] DLQ con error", safeError(error));
      message.retry({ delaySeconds: 60 });
    }
  }
}

/** Cron nocturno (etapa 3): analiza las conversaciones del día y deja aprendizajes pendientes. Solo con D1. */
async function nightlyLearning(env: Env): Promise<void> {
  if (!isD1(env)) {
    workerLog("[whatsapp-bot] aprendizaje nocturno: requiere DATA_BACKEND=d1, no se analiza nada");
    return;
  }
  const key = env.OPENAI_API_KEY?.trim();
  await runNightlyLearning({ db: d1Db(env), judge: key ? openAiJudge(key) : null, log: workerLog });
}

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(nightlyLearning(env).catch((error: unknown) => console.error("[whatsapp-bot] aprendizaje nocturno", safeError(error))));
  },

  async queue(batch: MessageBatch<InboundTurn>, env: Env): Promise<void> {
    if (batch.queue === DEAD_LETTER_QUEUE) {
      await consumeDeadTurns(batch, env);
      return;
    }
    await consumeTurns(batch, env);
  },

  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/health" && req.method === "GET") return health(env);
    if (url.pathname === WEBHOOK_PATH && req.method === "GET") return verifyWebhook(url, env);
    if (url.pathname === WEBHOOK_PATH && req.method === "POST") return receiveWebhook(req, env, ctx);

    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env, InboundTurn>;
