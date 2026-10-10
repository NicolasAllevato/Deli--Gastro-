import type { AssistantMessage, ChatMessage, LLM, LLMResult, ToolSpec } from "./types.ts";

const API_URL = "https://api.openai.com/v1";
const CHAT_TIMEOUT_MS = 30_000;
const TRANSCRIBE_TIMEOUT_MS = 60_000;
const TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const MAX_REPLY_TOKENS = 500;
const TEMPERATURE = 0.3;

export const DEFAULT_MODEL = "gpt-4o-mini";

export class OpenAIError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "OpenAIError";
    this.status = status;
  }
}

export interface OpenAIConfig {
  apiKey: string;
  model?: string;
}

interface ApiError {
  error?: { message?: string };
}

interface ChatResponse extends ApiError {
  choices?: Array<{ message?: AssistantMessage }>;
  usage?: { total_tokens?: number };
}

/** Cliente de OpenAI por `fetch` (sin SDK): chat con herramientas y transcripción de audio. */
export function createOpenAI(config: OpenAIConfig, fetchImpl: typeof fetch = fetch): LLM & {
  transcribe(audio: ArrayBuffer, mimeType: string): Promise<string>;
} {
  const model = config.model ?? DEFAULT_MODEL;
  const auth = { Authorization: `Bearer ${config.apiKey}` };

  async function post<T extends ApiError>(path: string, init: RequestInit, timeoutMs: number): Promise<T> {
    const res = await fetchImpl(`${API_URL}${path}`, { ...init, method: "POST", signal: AbortSignal.timeout(timeoutMs) });
    const json = (await res.json().catch(() => ({}))) as T;
    if (!res.ok) throw new OpenAIError(res.status, json.error?.message ?? `Error ${res.status} de OpenAI`);
    return json;
  }

  return {
    async chat(messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<LLMResult> {
      const body: Record<string, unknown> = {
        model,
        messages,
        temperature: TEMPERATURE,
        max_tokens: MAX_REPLY_TOKENS,
      };
      if (tools.length > 0) {
        body.tools = tools.map((t) => ({
          type: "function",
          function: { name: t.name, description: t.description, parameters: t.parameters },
        }));
      }

      const json = await post<ChatResponse>(
        "/chat/completions",
        { headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify(body) },
        CHAT_TIMEOUT_MS,
      );
      const message = json.choices?.[0]?.message;
      if (!message) throw new OpenAIError(502, "OpenAI no devolvió ninguna respuesta.");
      return { message: { ...message, role: "assistant" }, tokens: json.usage?.total_tokens ?? 0 };
    },

    async transcribe(audio: ArrayBuffer, mimeType: string): Promise<string> {
      const form = new FormData();
      form.set("file", new Blob([audio], { type: mimeType }), "audio.ogg");
      form.set("model", TRANSCRIBE_MODEL);
      form.set("language", "es");
      const json = await post<{ text?: string } & ApiError>(
        "/audio/transcriptions",
        { headers: auth, body: form },
        TRANSCRIBE_TIMEOUT_MS,
      );
      return (json.text ?? "").trim();
    },
  };
}
