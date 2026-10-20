/** Modelos de Workers AI (benchmark 2026-10-17, ver docs/PLAN_WORKER_BOT.md). Cambiarlos acá, no en la lógica. */
export const MODELS = {
  classifier: "@cf/mistralai/mistral-small-3.1-24b-instruct",
  responder: "@cf/qwen/qwen3-30b-a3b-fp8",
  responderFallback: "@cf/openai/gpt-oss-120b",
  transcriber: "@cf/openai/whisper-large-v3-turbo",
} as const;

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
