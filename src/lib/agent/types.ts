export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: "assistant";
  content: string | null;
  tool_calls?: ToolCall[];
}

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | AssistantMessage
  | { role: "tool"; tool_call_id: string; content: string };

/** Descripción de una herramienta tal como la ve el modelo (JSON Schema en `parameters`). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LLMResult {
  message: AssistantMessage;
  /** Tokens totales gastados en esta llamada (0 si el proveedor no los informa). */
  tokens: number;
}

/** Lo único que el agente necesita de un modelo: así se puede reemplazar en tests y en el demo. */
export interface LLM {
  chat(messages: readonly ChatMessage[], tools: readonly ToolSpec[]): Promise<LLMResult>;
}
