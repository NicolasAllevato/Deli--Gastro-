/**
 * Juez LLM: evalúa una conversación simulada. El parser no confía en el modelo: valida con zod y descarta lo inválido.
 */
import { z } from "zod";
import { ERROR_TIPOS, normalizeKey, sugerenciaKey, errorKey, type ErrorInput, type SugerenciaInput } from "../../src/lib/data/kb-aprendizaje.ts";
import { KB_CATEGORIAS } from "../../src/lib/data/kb-negocio.ts";
import type { Scenario } from "./escenarios.ts";
import { REPLIES } from "../../workers/whatsapp-bot/src/bot/prompts.ts";

export interface TranscriptLine {
  role: "cliente" | "bot";
  text: string;
}

const failureSchema = z.object({
  tipo: z.enum(ERROR_TIPOS),
  mensaje_cliente: z.string().min(1).max(1000),
  respuesta_mala: z.string().max(1000).default(""),
  motivo: z.string().min(1).max(500),
  correccion: z.string().min(1).max(300),
  causa: z.enum(["bot", "entorno", "cliente"]).catch("bot"),
});

const suggestionSchema = z.object({
  categoria: z.enum(KB_CATEGORIAS),
  tema: z.string().min(1).max(120),
  contenido: z.string().min(1).max(1000),
  evidencia: z.string().max(2000).default(""),
});

const verdictSchema = z.object({
  resuelto: z.boolean(),
  derivo: z.boolean(),
  invento_precios: z.boolean(),
  empatia: z.number().min(1).max(5),
  no_entendidas: z.array(z.string().max(200)).max(20).default([]),
  fallas: z.array(z.unknown()).max(10).default([]),
  sugerencias: z.array(z.unknown()).max(10).default([]),
});

export interface Verdict {
  resuelto: boolean;
  derivo: boolean;
  inventoPrecios: boolean;
  empatia: number;
  noEntendidas: string[];
  /** Fallas atribuibles al bot: las únicas que se aprenden. */
  fallas: ErrorInput[];
  /** Fallas del entorno simulado (fakes, menú, herramientas): van al informe, nunca a kb_errores. */
  fallasEntorno: ErrorInput[];
  /** La conversación se vio afectada por el entorno: no cuenta para la tasa de éxito. */
  entorno: boolean;
  sugerencias: SugerenciaInput[];
  /** Éxito del escenario: resolvió, derivó si debía, no inventó precios y empatía ≥ 3. */
  exito: boolean;
}

export const JUDGE_SYSTEM = `Sos un evaluador estricto de un asistente de WhatsApp de un local de comida argentino.
Recibís el escenario (objetivo del cliente y lo esperado del bot), el menú real y la conversación.
Devolvé SOLO un JSON con esta forma:
{"resuelto":bool,"derivo":bool,"invento_precios":bool,"empatia":1-5,"no_entendidas":["palabra o frase del cliente que el bot no entendió"],
 "fallas":[{"tipo":"precio_inventado|no_derivo|no_entendio|tono_frio|no_resolvio|otro","mensaje_cliente":"mensaje exacto del cliente","respuesta_mala":"respuesta exacta del bot","motivo":"por qué está mal","correccion":"regla corta e imperativa, una línea, para que no vuelva a pasar (sin datos personales)"}],
 "sugerencias":[{"categoria":"vocabulario|faq|politica|promo|otro","tema":"para vocabulario: cómo lo dice el cliente; para faq: la pregunta","contenido":"a qué se refiere / respuesta sugerida (sin inventar precios)","evidencia":"frase del cliente"}]}
Reglas: "derivo" es true si el bot pasó la charla a una persona. "invento_precios" es true si dio un precio, promo o producto que no está en el menú.
Empatía: 1 frío o cortante, 3 correcto, 5 cálido y empático. Las correcciones son reglas generales, no copias de la charla.
Las sugerencias solo si aportan conocimiento nuevo y útil para el local; nunca inventes precios.
Cada falla lleva "causa": "bot" si es una decisión o respuesta mala del asistente, o "entorno" si viene de la simulación
(herramienta con error técnico, respuesta vacía, el mensaje fijo "tuve un problema para responderte", logs de error).
Una derivación provocada por un error técnico NO es una derivación real: no cuenta como "derivo" y su falla es de "entorno".
Usá "causa": "cliente" si el cliente simulado abandonó o no llegó a la parte de su objetivo (por ejemplo, nunca pidió cancelar):
eso no es culpa del bot. En una queja, derivar a una persona ES resolverla. Marcá "no_derivo" solo si el bot no derivó.
Falla grave del bot (tipo "otro", resuelto=false): decir que un pedido está confirmado, pagado, "en proceso" o "en camino"
sin que antes aparezca el mensaje de pago de Mercado Pago; o repetir la misma pregunta de confirmación en bucle.`;

export function buildJudgeInput(scenario: Scenario, menu: string, transcript: readonly TranscriptLine[], logs: readonly string[] = []): string {
  const chat = transcript.map((l) => `${l.role === "cliente" ? "CLIENTE" : "BOT"}: ${l.text}`).join("\n");
  return [
    `Escenario: ${scenario.type}. Persona: ${scenario.persona}.`,
    `Objetivo del cliente: ${scenario.goal}`,
    `Esperado del bot: ${scenario.expected}`,
    `Debe derivar a una persona: ${scenario.mustHandoff ? "sí" : "no"}`,
    "",
    "Menú real:",
    menu,
    "",
    "Conversación:",
    chat,
    "",
    "Logs técnicos del bot (vacío = sin errores):",
    logs.length ? logs.slice(0, 20).join("\n") : "(ninguno)",
  ].join("\n");
}

function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Parsea y valida la salida del juez; null si no sirve. Las fallas/sugerencias inválidas se descartan una por una. */
/** Señales técnicas del entorno en los logs del bot (respuesta vacía o bloqueada, errores). */
export function environmentSignals(logs: readonly string[]): boolean {
  return logs.some((l) => /respuesta bloqueada|imitó una plantilla|error/i.test(l));
}

const FAILURE_REPLY = REPLIES.failure.slice(0, 40);

/**
 * Parsea y valida la salida del juez; null si no sirve. Las fallas/sugerencias inválidas se descartan una por una.
 * `environmentHit`: hubo señales técnicas en los logs. Toda falla cuya respuesta mala es el mensaje fijo de error
 * se atribuye al entorno aunque el juez diga "bot" (así no se aprenden errores falsos como "no_derivo").
 */
export interface ObservedFacts {
  /** El bot derivó de verdad (la conversación quedó en manos de una persona sin error técnico). */
  handedOff?: boolean;
}

export function parseVerdict(
  raw: string, scenario: Pick<Scenario, "type" | "mustHandoff">, environmentHit = false, facts: ObservedFacts = {},
): Verdict | null {
  const parsed = verdictSchema.safeParse(extractJson(raw));
  if (!parsed.success) return null;
  // Los hechos observados ganan sobre la opinión del juez.
  const derivo = facts.handedOff === undefined ? parsed.data.derivo : facts.handedOff && !environmentHit;
  const v = { ...parsed.data, derivo, resuelto: parsed.data.resuelto || (scenario.mustHandoff && derivo) };
  const all = v.fallas.flatMap((f) => {
    const r = failureSchema.safeParse(f);
    if (!r.success) return [];
    const { causa, ...rest } = r.data;
    // Un "no_derivo" cuando sí derivó es un error del juez: se descarta.
    // Tampoco cuenta "no_derivo" en escenarios que no requieren derivar.
    if (rest.tipo === "no_derivo" && (derivo || !scenario.mustHandoff)) return [];
    const fromEnv =
      causa !== "bot" || rest.respuesta_mala.includes(FAILURE_REPLY) || (environmentHit && rest.tipo === "no_derivo");
    return [{ failure: { ...rest, escenario: scenario.type } as ErrorInput, fromEnv }];
  });
  const fallas = all.filter((f) => !f.fromEnv).map((f) => f.failure);
  const fallasEntorno = all.filter((f) => f.fromEnv).map((f) => f.failure);
  const entorno = environmentHit || fallasEntorno.length > 0;
  const sugerencias = v.sugerencias.flatMap((s) => {
    const r = suggestionSchema.safeParse(s);
    return r.success ? [r.data] : [];
  });
  // Coherencia: si debía derivar y no derivó, el escenario falla aunque el juez diga "resuelto".
  const derivacionOk = !scenario.mustHandoff || v.derivo;
  const exito = v.resuelto && derivacionOk && !v.invento_precios && v.empatia >= 3;
  return {
    resuelto: v.resuelto,
    derivo: v.derivo,
    inventoPrecios: v.invento_precios,
    empatia: v.empatia,
    noEntendidas: v.no_entendidas.map((s) => s.trim()).filter(Boolean),
    fallas,
    fallasEntorno,
    entorno,
    sugerencias,
    exito,
  };
}

/** Deduplica por la misma clave que usa la base (así el informe cuenta igual que kb_errores/kb_sugerencias). */
export function dedupeFailures(items: readonly ErrorInput[]): Array<ErrorInput & { veces: number }> {
  const map = new Map<string, ErrorInput & { veces: number }>();
  for (const it of items) {
    const key = errorKey(it);
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, veces: prev.veces + 1 } : { ...it, veces: 1 });
  }
  return [...map.values()].sort((a, b) => b.veces - a.veces);
}

export function dedupeSuggestions(items: readonly SugerenciaInput[]): Array<SugerenciaInput & { veces: number }> {
  const map = new Map<string, SugerenciaInput & { veces: number }>();
  for (const it of items) {
    if (!normalizeKey(it.tema)) continue;
    const key = sugerenciaKey(it);
    const prev = map.get(key);
    map.set(key, prev ? { ...prev, veces: prev.veces + 1 } : { ...it, veces: 1 });
  }
  return [...map.values()].sort((a, b) => b.veces - a.veces);
}
