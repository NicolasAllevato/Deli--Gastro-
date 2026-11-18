/**
 * `RunModel` sobre la API de chat de OpenAI (mismo formato que ya usan el aprendizaje nocturno y el simulador).
 * Recibe la entrada tal cual la arman el clasificador y el respondedor (messages, tools, tool_choice,
 * response_format, max_tokens, temperature) y devuelve la respuesta cruda en formato `choices`,
 * que `responseText` / `responseToolCalls` ya saben leer.
 * La clave nunca se loguea y los errores no incluyen el cuerpo de la respuesta.
 */
import { isWorkersAiModel, type RunModel } from "./models.ts";

const API_URL = "https://api.openai.com/v1/chat/completions";
/** Si OpenAI tarda más que esto, se corta y entra el respaldo de Workers AI. */
export const OPENAI_TIMEOUT_MS = 15_000;

const PASSTHROUGH = ["tools", "tool_choice", "response_format", "max_tokens", "temperature"] as const;

/** OpenAI no acepta `name` en los mensajes de herramienta ni `tool_calls` vacíos: se limpian. */
function cleanMessages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return [];
  return messages.map((m) => {
    const { name: _name, tool_calls, ...rest } = m as Record<string, unknown>;
    void _name;
    const out: Record<string, unknown> = { ...rest };
    if (Array.isArray(tool_calls) && tool_calls.length > 0) out.tool_calls = tool_calls;
    return out;
  });
}

export function openAiChatBody(model: string, input: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = { model, messages: cleanMessages(input.messages) };
  for (const key of PASSTHROUGH) if (input[key] !== undefined) body[key] = input[key];
  return body;
}

export function openAiRunModel(apiKey: string, fetchFn: typeof fetch = fetch, timeoutMs = OPENAI_TIMEOUT_MS): RunModel {
  return async (model, input) => {
    if (!apiKey) throw new Error("Falta OPENAI_API_KEY");
    const res = await fetchFn(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(openAiChatBody(model, input)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}`);
    return res.json();
  };
}

/** Despacha cada modelo a su proveedor: `@cf/...` → Workers AI; el resto → OpenAI. */
export function routedRunModel(workersAi: RunModel, openAi: RunModel): RunModel {
  return (model, input) => (isWorkersAiModel(model) ? workersAi(model, input) : openAi(model, input));
}
