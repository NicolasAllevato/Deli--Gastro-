import type { ChatMessage, LLM, ToolCall, ToolSpec } from "./types.ts";

const DEFAULT_MAX_STEPS = 6;
const DEFAULT_FALLBACK = "Perdón, tuve un problema. ¿Me lo repetís?";
/** Tope de herramientas ejecutadas por turno: un modelo desbocado no puede disparar decenas de escrituras. */
export const MAX_TOOL_CALLS_PER_TURN = 8;

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

const validationText = (error: unknown) => (error instanceof Error ? error.message : "Argumentos inválidos.");

async function executeTool(call: ToolCall, tools: readonly AgentTool[]): Promise<string> {
  const tool = tools.find((t) => t.name === call.function.name);
  if (!tool) return JSON.stringify({ error: `Herramienta desconocida: ${call.function.name}` });

  let raw: unknown;
  try {
    raw = JSON.parse(call.function.arguments || "{}");
  } catch {
    return JSON.stringify({ error: "Los argumentos no son JSON válido." });
  }

  let args: unknown;
  try {
    args = tool.validate(raw);
  } catch (error: unknown) {
    // Argumentos mal armados: el modelo los puede corregir y reintentar.
    return JSON.stringify({ error: validationText(error) });
  }

  try {
    return JSON.stringify(await tool.run(args));
  } catch (error: unknown) {
    // El detalle (base de datos, red) queda en el log: al modelo, y por él al cliente, no le llega.
    console.error("[agente] falló la herramienta", call.function.name, error);
    return JSON.stringify({ error: "No se pudo completar la acción. Pedile al cliente que reintente en un momento." });
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
  let toolCalls = 0;

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
      // Cada tool_call necesita su respuesta aunque no se ejecute, o la API rechaza el mensaje siguiente.
      const content = toolCalls < MAX_TOOL_CALLS_PER_TURN
        ? await executeTool(call, run.tools)
        : JSON.stringify({ error: "Demasiadas herramientas en un mismo turno; respondé con lo que ya tenés." });
      toolCalls += 1;
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { reply: fallback, tokens, hitStepLimit: true };
}
