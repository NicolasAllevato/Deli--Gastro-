import type { ChatMessage, LLM, ToolCall, ToolSpec } from "./types.ts";

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_FALLBACK = "Perdón, tuve un problema. ¿Me lo repetís?";

/** Herramienta del agente: `validate` revisa los argumentos del modelo (lanza si son inválidos). */
export interface AgentTool extends ToolSpec {
  validate(raw: unknown): unknown;
  run(args: unknown): Promise<unknown>;
}

export interface AgentRun {
  llm: LLM;
  system: string;
  history: readonly ChatMessage[];
  tools: readonly AgentTool[];
  maxSteps?: number;
  /** Texto que se envía si el modelo no logra una respuesta válida. */
  fallbackReply?: string;
}

export interface AgentResult {
  reply: string;
  tokens: number;
  hitStepLimit: boolean;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : "Error desconocido");

async function executeTool(call: ToolCall, tools: readonly AgentTool[]): Promise<string> {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return JSON.stringify({ error: `Herramienta desconocida: ${call.function.name}` });

  let raw: unknown;
  try {
    raw = JSON.parse(call.function.arguments || "{}");
  } catch {
    return JSON.stringify({ error: "Los argumentos no son JSON válido." });
  }

  try {
    return JSON.stringify(await tool.run(tool.validate(raw)));
  } catch (error: unknown) {
    // El error vuelve al modelo para que lo explique o corrija; nunca tumba el turno.
    return JSON.stringify({ error: errorText(error) });
  }
}

/**
 * Bucle de herramientas: el modelo responde o pide herramientas; se ejecutan,
 * se le devuelve el resultado y se repite hasta tener una respuesta de texto.
 */
export async function runAgent(run: AgentRun): Promise<AgentResult> {
  const maxSteps = run.maxSteps ?? DEFAULT_MAX_STEPS;
  const fallback = run.fallbackReply ?? DEFAULT_FALLBACK;
  const messages: ChatMessage[] = [{ role: "system", content: run.system }, ...run.history];
  let tokens = 0;

  for (let step = 0; step < maxSteps; step++) {
    const result = await run.llm.chat(messages, run.tools);
    tokens += result.tokens;
    const { message } = result;

    if (!message.tool_calls || message.tool_calls.length === 0) {
      const reply = message.content?.trim() ?? "";
      return { reply: reply || fallback, tokens, hitStepLimit: false };
    }

    messages.push(message);
    for (const call of message.tool_calls) {
      messages.push({ role: "tool", tool_call_id: call.id, content: await executeTool(call, run.tools) });
    }
  }

  return { reply: fallback, tokens, hitStepLimit: true };
}
