/**
 * Adaptador OpenAI para el simulador: cualquier modelo del bot (Workers AI) se corre con GPT-4o mini.
 * La clave se lee de .env.local sin imprimirla y nunca se loguea.
 */
import { existsSync, readFileSync } from "node:fs";
import type { RunModel } from "../../workers/whatsapp-bot/src/ai/models.ts";
import type { Budget } from "./presupuesto.ts";

export const SIM_MODEL = "gpt-4o-mini";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";

/** Busca OPENAI_API_KEY en el entorno o en .env.local (worktree o repo principal). */
export function readOpenAiKey(candidates: readonly URL[]): string | null {
  if (process.env.OPENAI_API_KEY?.trim()) return process.env.OPENAI_API_KEY.trim();
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split(/\r?\n/).find((l) => /^\s*OPENAI_API_KEY\s*=/.test(l));
    const value = line?.replace(/^\s*OPENAI_API_KEY\s*=\s*/, "").trim().replace(/^["']|["']$/g, "");
    if (value) return value;
  }
  return null;
}

/** OpenAI rechaza `name` en mensajes `tool`; el resto del formato del bot ya es compatible. */
function cleanMessages(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages;
  return messages.map((m: Record<string, unknown>) => (m.role === "tool" ? { role: "tool", tool_call_id: m.tool_call_id, content: m.content } : m));
}

export function openAiRunner(apiKey: string, budget: Budget): RunModel {
  return async (_model, input) => {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, messages: cleanMessages(input.messages), model: SIM_MODEL }),
    });
    const json = (await res.json().catch(() => null)) as { usage?: { prompt_tokens?: number; completion_tokens?: number }; error?: { message?: string } } | null;
    budget.add(json?.usage);
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${json?.error?.message?.slice(0, 200) ?? "sin detalle"}`);
    return json;
  };
}

/** Llamada de texto simple (cliente simulado y juez), con JSON forzado. */
export async function chatJson(run: RunModel, system: string, user: string, maxTokens = 900): Promise<string> {
  const raw = (await run(SIM_MODEL, {
    messages: [{ role: "system", content: system }, { role: "user", content: user }],
    response_format: { type: "json_object" },
    max_tokens: maxTokens,
    temperature: 0.7,
  })) as { choices?: { message?: { content?: string } }[] };
  return raw?.choices?.[0]?.message?.content ?? "";
}

/**
 * Envuelve el modelo para registrar cada herramienta: la llamada con sus argumentos (lo que pide el modelo) y el resultado
 * que recibe (mensajes `tool` nuevos al final del historial de la siguiente llamada).
 */
export function conRegistroDeHerramientas(run: RunModel, sink: (line: string) => void): RunModel {
  const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n)}…(${s.length} car.)` : s);
  return async (model, input) => {
    const messages = Array.isArray((input as { messages?: unknown }).messages) ? ((input as { messages: Record<string, unknown>[] }).messages) : [];
    let at = messages.length;
    while (at > 0 && messages[at - 1].role === "tool") at--;
    for (const m of messages.slice(at)) sink(`  TOOL-RESULT ${clip(String(m.content ?? ""), 1500)}`);
    const out = await run(model, input);
    const calls = (out as { choices?: { message?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] } }[] })?.choices?.[0]?.message?.tool_calls ?? [];
    const resp = (out as { choices?: { message?: { content?: string | null } }[] })?.choices?.[0]?.message;
    const offered = ((input as { tools?: { function?: { name?: string } }[] }).tools ?? []).map((t) => t.function?.name).join(",");
    sink(`MODEL tools=[${offered}] -> ${calls.length ? `${calls.length} llamada(s)` : clip(String(resp?.content ?? ""), 160).replace(/\s+/g, " ")}`);
    for (const c of calls) sink(`TOOL-CALL ${c.function?.name ?? "?"}(${clip(c.function?.arguments ?? "", 400)})`);
    return out;
  };
}
