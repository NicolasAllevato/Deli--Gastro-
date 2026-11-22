/**
 * Juez LLM compartido: esquema de salida, parseo validado con zod y deduplicación. Lo usan el simulador
 * (scripts/simulador/juez.ts) y el análisis nocturno de conversaciones reales del Worker whatsapp-bot.
 * Módulo puro: sin red ni base.
 */
import { z } from "zod";
import { ERROR_TIPOS, normalizeKey, sugerenciaKey, errorKey, type ErrorInput, type SugerenciaInput } from "./kb-aprendizaje.ts";
import { KB_CATEGORIAS } from "./kb-negocio.ts";

export const failureSchema = z.object({
  tipo: z.enum(ERROR_TIPOS),
  mensaje_cliente: z.string().min(1).max(1000),
  respuesta_mala: z.string().max(1000).default(""),
  motivo: z.string().min(1).max(500),
  correccion: z.string().min(1).max(300),
  causa: z.enum(["bot", "entorno", "cliente"]).catch("bot"),
});

export const suggestionSchema = z.object({
  categoria: z.enum(KB_CATEGORIAS),
  tema: z.string().min(1).max(120),
  contenido: z.string().min(1).max(1000),
  evidencia: z.string().max(2000).default(""),
});

export const verdictSchema = z.object({
  resuelto: z.boolean(),
  derivo: z.boolean(),
  invento_precios: z.boolean(),
  empatia: z.number().min(1).max(5),
  no_entendidas: z.array(z.string().max(200)).max(20).default([]),
  fallas: z.array(z.unknown()).max(10).default([]),
  sugerencias: z.array(z.unknown()).max(10).default([]),
  cliente_incompleto: z.boolean().default(false),
});

/** Forma del JSON que devuelve el juez (misma para simulación y conversaciones reales). */
export const JUDGE_JSON_SHAPE = `{"resuelto":bool,"derivo":bool,"invento_precios":bool,"empatia":1-5,"no_entendidas":["palabra o frase del cliente que el bot no entendió"],
 "fallas":[{"tipo":"precio_inventado|no_derivo|no_entendio|tono_frio|no_resolvio|otro","mensaje_cliente":"mensaje exacto del cliente","respuesta_mala":"respuesta exacta del bot","motivo":"por qué está mal","correccion":"regla corta e imperativa, una línea, para que no vuelva a pasar (sin datos personales)"}],
 "sugerencias":[{"categoria":"vocabulario|faq|politica|promo|otro","tema":"para vocabulario: cómo lo dice el cliente; para faq: la pregunta","contenido":"a qué se refiere / respuesta sugerida (sin inventar precios)","evidencia":"frase del cliente"}],
 "cliente_incompleto":bool}`;

export function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
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

// --- Conversaciones reales (cron nocturno). -------------------------------------------------------------------

export const REAL_SCENARIO = "conversacion_real";

export const JUDGE_REAL_SYSTEM = `Sos un evaluador estricto de un asistente de WhatsApp de un local de comida argentino.
Recibís una conversación REAL entre un cliente y el bot, ya anonimizada: [telefono], [email], [direccion], [dni], [tarjeta],
[cbu] y [nombre] reemplazan datos personales. Nunca intentes reconstruirlos ni los copies en tu respuesta.
Devolvé SOLO un JSON con esta forma:
${JUDGE_JSON_SHAPE}
Los mensajes que empiezan con "Resumen de tu pedido" o "¡Listo! Para confirmar" son plantillas del sistema con montos correctos.
Una charla que termina sin cerrar un pedido no es falla del bot si el cliente dejó de escribir ("cliente_incompleto": true).
Fallas: solo decisiones o respuestas del bot ("causa":"bot"). Las correcciones son reglas generales, sin datos de la charla.
Sugerencias: solo conocimiento nuevo y útil para el local. Incluí como "vocabulario" la jerga, abreviaturas o apodos de
productos que usó el cliente (tema = cómo lo dijo, contenido = a qué se refiere). Nunca inventes precios ni promos.`;

/** Entrada del juez para una conversación real (el texto ya tiene que venir enmascarado). */
export function buildRealJudgeInput(maskedTranscript: string, menu: string): string {
  return ["Menú real:", menu || "(sin menú)", "", "Conversación:", maskedTranscript].join("\n");
}

export interface RealVerdict {
  fallas: ErrorInput[];
  sugerencias: SugerenciaInput[];
}

/** Parsea la salida del juez para una conversación real; null si no sirve. Descarta fallas del cliente o del entorno. */
export function parseRealVerdict(raw: string): RealVerdict | null {
  const parsed = verdictSchema.safeParse(extractJson(raw));
  if (!parsed.success) return null;
  const fallas = parsed.data.fallas.flatMap((f) => {
    const r = failureSchema.safeParse(f);
    if (!r.success || r.data.causa !== "bot") return [];
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- se descarta `causa` a propósito
    const { causa: _causa, ...rest } = r.data;
    return [{ ...rest, escenario: REAL_SCENARIO } as ErrorInput];
  });
  const sugerencias = parsed.data.sugerencias.flatMap((s) => {
    const r = suggestionSchema.safeParse(s);
    return r.success ? [r.data] : [];
  });
  return { fallas, sugerencias };
}
