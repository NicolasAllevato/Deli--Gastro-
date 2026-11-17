import { MODELS, responseText, responseToolCalls, type ChatMessage, type RunModel } from "./models.ts";

export interface BotTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  /** Recibe los argumentos ya parseados (sin validar: cada herramienta valida los suyos). */
  run: (args: unknown) => Promise<unknown>;
}

export interface ResponderInput {
  system: string;
  history: ChatMessage[];
  userText: string;
  tools: BotTool[];
}

/** Vueltas máximas modelo → herramienta → modelo: corta bucles y acota el costo. */
export const MAX_STEPS = 5;
const MAX_TOOL_RESULT_CHARS = 6000;

function toolSpec(tool: BotTool) {
  return { type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } };
}

async function runTool(tools: BotTool[], name: string, rawArgs: string): Promise<string> {
  // Lista blanca: el modelo solo puede usar las herramientas que le dimos para esta intención.
  const tool = tools.find((t) => t.name === name);
  if (!tool) return JSON.stringify({ error: `La herramienta ${name} no está disponible.` });
  let args: unknown = {};
  try {
    args = rawArgs ? JSON.parse(rawArgs) : {};
  } catch {
    return JSON.stringify({ error: "Argumentos inválidos." });
  }
  try {
    return JSON.stringify(await tool.run(args)).slice(0, MAX_TOOL_RESULT_CHARS);
  } catch (error: unknown) {
    return JSON.stringify({ error: error instanceof Error ? error.message : "Error de la herramienta." });
  }
}

/** Bucle de herramientas: devuelve el texto final para el cliente (vacío si el modelo no respondió). */
export async function respond(run: RunModel, input: ResponderInput, model: string = MODELS.responder): Promise<string> {
  const messages: ChatMessage[] = [{ role: "system", content: input.system }, ...input.history, { role: "user", content: input.userText }];
  const tools = input.tools.map(toolSpec);

  for (let step = 0; step < MAX_STEPS; step++) {
    // La última vuelta va sin herramientas: el modelo tiene que contestar con texto (nunca queda vacío por agotar pasos).
    const last = step === MAX_STEPS - 1;
    const toolOpts = tools.length > 0 ? { tools, ...(last ? { tool_choice: "none" } : {}) } : {};
    const raw = await run(model, { messages, ...toolOpts, max_tokens: 600, temperature: 0.2 });
    const calls = responseToolCalls(raw);
    if (calls.length === 0) return cleanReply(responseText(raw));

    messages.push({ role: "assistant", content: "", tool_calls: calls });
    for (const call of calls) {
      messages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: await runTool(input.tools, call.function.name, call.function.arguments) });
    }
  }
  return "";
}

/**
 * Deja el texto listo para WhatsApp: saca el razonamiento <think> de Qwen y pasa el Markdown
 * (`**negrita**`, `# título`) al formato de WhatsApp (`*negrita*`).
 */
export function cleanReply(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
}
