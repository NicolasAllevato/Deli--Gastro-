/**
 * Modelos del bot. Cambiarlos acá, no en la lógica.
 * - Los que empiezan con `@cf/` corren en Workers AI; el resto, en la API de OpenAI (secret OPENAI_API_KEY).
 * - Desde 2026-11-17 el clasificador y el respondedor van por OpenAI gpt-4o-mini (entiende mejor el
 *   rioplatense); los de Workers AI quedan como respaldo automático si OpenAI falla, tarda o falta la clave.
 */
export const MODELS = {
  classifier: "gpt-4o-mini",
  classifierFallback: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  responder: "gpt-4o-mini",
  responderFallback: "@cf/qwen/qwen3-30b-a3b-fp8",
  transcriber: "@cf/openai/whisper-large-v3-turbo",
} as const;

/** true = el modelo corre en Workers AI (`env.AI.run`); false = API de OpenAI. */
export const isWorkersAiModel = (model: string): boolean => model.startsWith("@cf/");

/** Corre `primary` y, si falla (error, timeout, sin clave), el respaldo de Workers AI con la misma entrada. */
export async function runWithFallback(
  run: RunModel, primary: string, fallback: string, input: Record<string, unknown>, log?: (message: string, detail?: unknown) => void,
): Promise<unknown> {
  try {
    return await run(primary, input);
  } catch (error: unknown) {
    if (primary === fallback) throw error;
    log?.("[whatsapp-bot] modelo principal falló, uso el respaldo", { primary, fallback, error: error instanceof Error ? error.message : "error" });
    return run(fallback, input);
  }
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Llamada a un modelo de texto: en producción `env.AI.run`, en los tests una función falsa. */
export type RunModel = (model: string, input: Record<string, unknown>) => Promise<unknown>;

/** Texto de la respuesta, venga en formato OpenAI (`choices`) o en el nativo de Workers AI (`response`). */
export function responseText(raw: unknown): string {
  const r = (raw ?? {}) as { response?: unknown; choices?: { message?: { content?: unknown } }[] };
  const out = r.choices?.[0]?.message?.content ?? r.response ?? "";
  return typeof out === "string" ? out : JSON.stringify(out);
}

/** Llamadas a herramientas de la respuesta, normalizadas al formato OpenAI. */
export function responseToolCalls(raw: unknown): ToolCall[] {
  const r = (raw ?? {}) as {
    tool_calls?: unknown[];
    choices?: { message?: { tool_calls?: unknown[] } }[];
  };
  const calls = r.choices?.[0]?.message?.tool_calls ?? r.tool_calls ?? [];
  return calls.flatMap((call, i) => {
    const c = call as { id?: string; name?: string; arguments?: unknown; function?: { name?: string; arguments?: unknown } };
    const name = c.function?.name ?? c.name;
    if (!name) return [];
    const args = c.function?.arguments ?? c.arguments ?? {};
    return [{
      id: c.id ?? `call_${i}`,
      type: "function" as const,
      function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
    }];
  });
}
