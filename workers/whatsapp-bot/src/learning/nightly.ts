/**
 * Etapa 3: aprendizaje nocturno desde conversaciones reales (cron del Worker, ~03:00 AR).
 * Toma las conversaciones con actividad en las últimas 24 h, ENMASCARA la transcripción (privacy.ts), la pasa por el
 * juez compartido con el simulador (src/lib/data/kb-juez.ts) y guarda fallas y sugerencias como `pendiente`
 * (origen 'conversacion'), deduplicadas por `clave`. Nada se aplica solo: el admin aprueba en /admin/conocimiento.
 * Idempotente por (conversación, día) con kb_analisis_conversaciones; topes de conversaciones y de tokens.
 * Logs sin PII: solo contadores.
 */
import type { SqlDatabase } from "../../../../src/lib/data/sql.ts";
import { systemActor } from "../../../../src/lib/data/actor.ts";
import { recordError, recordSugerencia, type ErrorInput, type SugerenciaInput } from "../../../../src/lib/data/kb-aprendizaje.ts";
import { buildRealJudgeInput, dedupeFailures, dedupeSuggestions, JUDGE_REAL_SYSTEM, parseRealVerdict } from "../../../../src/lib/data/kb-juez.ts";
import { maskTranscriptPii, type MaskContext } from "../../../../src/lib/whatsapp/privacy.ts";
import { fromCents } from "../../../../src/lib/data/money.ts";

export interface JudgeResult {
  content: string;
  tokens: number;
}
/** Llamada al modelo (OpenAI en producción, un fake en los tests). Recibe SOLO texto ya enmascarado. */
export type JudgeFn = (system: string, user: string) => Promise<JudgeResult>;

export interface LearningLimits {
  /** Tope de conversaciones por noche. */
  maxConversations: number;
  /** Tope de tokens (gasto) por noche: al superarlo no se analizan más conversaciones. */
  maxTokens: number;
  /** Mensajes por conversación que se mandan al juez (los más viejos del día). */
  maxMessages: number;
}

export const DEFAULT_LIMITS: LearningLimits = { maxConversations: 200, maxTokens: 1_500_000, maxMessages: 60 };
const MAX_CONSECUTIVE_ERRORS = 3;
const DAY_MS = 86_400_000;

export interface LearningDeps {
  db: SqlDatabase;
  judge: JudgeFn | null;
  now?: Date;
  log: (message: string, detail?: unknown) => void;
  newId?: () => string;
  limits?: Partial<LearningLimits>;
}

export interface LearningSummary {
  skipped?: "sin_openai";
  analizadas: number;
  vacias: number;
  invalidas: number;
  errores: number;
  fallas: number;
  sugerencias: number;
  tokens: number;
  topeAlcanzado: boolean;
}

interface Candidate {
  id: string;
  client_id: string | null;
  contact_name: string | null;
  client_name: string | null;
  client_address: string | null;
}

async function candidates(db: SqlDatabase, since: string, dia: string, limit: number): Promise<Candidate[]> {
  const { results } = await db
    .prepare(
      `SELECT c.id, c.client_id, c.contact_name, cl.name AS client_name, cl.address AS client_address
       FROM wa_conversations c LEFT JOIN clients cl ON cl.id = c.client_id
       WHERE EXISTS (SELECT 1 FROM wa_messages m WHERE m.conversation_id = c.id AND m.created_at > ?)
         AND NOT EXISTS (SELECT 1 FROM kb_analisis_conversaciones a WHERE a.conversation_id = c.id AND a.dia = ?)
       ORDER BY coalesce(c.last_inbound_at, c.created_at) DESC LIMIT ?`,
    )
    .bind(since, dia, limit)
    .all<Candidate>();
  return results;
}

async function maskContext(db: SqlDatabase, c: Candidate): Promise<MaskContext> {
  const addresses: string[] = c.client_address ? [c.client_address] : [];
  if (c.client_id) {
    const { results } = await db
      .prepare("SELECT DISTINCT delivery_address FROM orders WHERE client_id = ? AND delivery_address IS NOT NULL LIMIT 20")
      .bind(c.client_id)
      .all<{ delivery_address: string }>();
    addresses.push(...results.map((r) => r.delivery_address));
  }
  return { names: [c.contact_name, c.client_name], addresses };
}

/** Transcripción enmascarada del día; null si el cliente no escribió nada. */
export async function maskedTranscript(db: SqlDatabase, conversationId: string, since: string, ctx: MaskContext, maxMessages: number): Promise<string | null> {
  const { results } = await db
    .prepare("SELECT direction, body FROM wa_messages WHERE conversation_id = ? AND created_at > ? AND body IS NOT NULL ORDER BY created_at LIMIT ?")
    .bind(conversationId, since, maxMessages)
    .all<{ direction: "in" | "out"; body: string }>();
  if (!results.some((m) => m.direction === "in" && m.body.trim())) return null;
  return results.map((m) => `${m.direction === "in" ? "CLIENTE" : "BOT"}: ${maskTranscriptPii(m.body.replace(/\s+/g, " ").trim(), ctx)}`).join("\n");
}

async function menuText(db: SqlDatabase): Promise<string> {
  const { results } = await db
    .prepare("SELECT name, price_cents FROM products WHERE is_active = 1 AND COALESCE(show_in_portal, 1) = 1 ORDER BY name LIMIT 200")
    .all<{ name: string; price_cents: number }>();
  return results.map((p) => `- ${p.name}: $${fromCents(p.price_cents).toLocaleString("es-AR")}`).join("\n");
}

/** Segunda pasada de enmascarado sobre lo que devolvió el modelo (por si copió algo): nada con PII llega a la base. */
function maskFailure(f: ErrorInput, ctx: MaskContext): ErrorInput {
  const m = (s: string | undefined) => maskTranscriptPii(s ?? "", ctx);
  return { ...f, mensaje_cliente: m(f.mensaje_cliente), respuesta_mala: m(f.respuesta_mala), motivo: m(f.motivo), correccion: m(f.correccion) };
}
function maskSuggestion(s: SugerenciaInput, ctx: MaskContext): SugerenciaInput {
  const m = (x: string | undefined) => maskTranscriptPii(x ?? "", ctx);
  return { ...s, tema: m(s.tema), contenido: m(s.contenido), evidencia: m(s.evidencia) };
}

async function mark(db: SqlDatabase, id: string, dia: string, resultado: "ok" | "invalido" | "vacia", fallas: number, sugerencias: number, tokens: number) {
  await db
    .prepare("INSERT INTO kb_analisis_conversaciones (conversation_id, dia, resultado, fallas, sugerencias, tokens) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (conversation_id, dia) DO NOTHING")
    .bind(id, dia, resultado, fallas, sugerencias, tokens)
    .run();
}

/** Corre el análisis nocturno. Sin `judge` (falta OPENAI_API_KEY) no hace nada. */
export async function runNightlyLearning(deps: LearningDeps): Promise<LearningSummary> {
  const summary: LearningSummary = { analizadas: 0, vacias: 0, invalidas: 0, errores: 0, fallas: 0, sugerencias: 0, tokens: 0, topeAlcanzado: false };
  if (!deps.judge) {
    deps.log("[whatsapp-bot] aprendizaje nocturno: falta OPENAI_API_KEY, no se analiza nada");
    return { ...summary, skipped: "sin_openai" };
  }
  const limits = { ...DEFAULT_LIMITS, ...deps.limits };
  const now = deps.now ?? new Date();
  const dia = now.toISOString().slice(0, 10);
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const actor = systemActor("aprendizaje nocturno de conversaciones");
  const list = await candidates(deps.db, since, dia, limits.maxConversations);
  const menu = await menuText(deps.db);
  let consecutiveErrors = 0;

  for (const c of list) {
    if (summary.tokens >= limits.maxTokens) {
      summary.topeAlcanzado = true;
      break;
    }
    const ctx = await maskContext(deps.db, c);
    const transcript = await maskedTranscript(deps.db, c.id, since, ctx, limits.maxMessages);
    if (!transcript) {
      await mark(deps.db, c.id, dia, "vacia", 0, 0, 0);
      summary.vacias += 1;
      continue;
    }
    let result: JudgeResult;
    try {
      result = await deps.judge(JUDGE_REAL_SYSTEM, buildRealJudgeInput(transcript, menu));
      consecutiveErrors = 0;
    } catch {
      // Sin marca: se puede reintentar. Nunca se loguea el error crudo (podría traer el cuerpo enviado).
      summary.errores += 1;
      consecutiveErrors += 1;
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) break;
      continue;
    }
    summary.tokens += Math.max(0, result.tokens);
    const verdict = parseRealVerdict(result.content);
    if (!verdict) {
      await mark(deps.db, c.id, dia, "invalido", 0, 0, result.tokens);
      summary.invalidas += 1;
      continue;
    }
    const fallas = dedupeFailures(verdict.fallas.map((f) => maskFailure(f, ctx)));
    const sugerencias = dedupeSuggestions(verdict.sugerencias.map((s) => maskSuggestion(s, ctx)));
    for (const { veces, ...f } of fallas) await recordError(deps.db, actor, newId(), f, { origen: "conversacion", veces });
    for (const { veces, ...s } of sugerencias) await recordSugerencia(deps.db, actor, newId(), s, { origen: "conversacion", veces });
    await mark(deps.db, c.id, dia, "ok", fallas.length, sugerencias.length, result.tokens);
    summary.analizadas += 1;
    summary.fallas += fallas.length;
    summary.sugerencias += sugerencias.length;
  }
  deps.log("[whatsapp-bot] aprendizaje nocturno", summary);
  return summary;
}

export const LEARNING_MODEL = "gpt-4o-mini";

/** Juez sobre OpenAI. La clave nunca se loguea; los errores no incluyen el cuerpo de la respuesta. */
export function openAiJudge(apiKey: string, fetchFn: typeof fetch = fetch): JudgeFn {
  return async (system, user) => {
    const res = await fetchFn("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LEARNING_MODEL,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_object" },
        max_tokens: 1200,
        temperature: 0.2,
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    const json = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { total_tokens?: number } };
    return { content: json.choices?.[0]?.message?.content ?? "", tokens: Number(json.usage?.total_tokens ?? 0) };
  };
}
