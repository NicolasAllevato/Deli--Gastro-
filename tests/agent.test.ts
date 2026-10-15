import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAI, OpenAIError } from "../src/lib/agent/openai.ts";
import { MAX_TOOL_CALLS_PER_TURN, runAgent, type AgentTool } from "../src/lib/agent/loop.ts";
import type { AssistantMessage, ChatMessage, LLM } from "../src/lib/agent/types.ts";

function fakeFetch(response: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(response), { status, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;
  return { impl, calls };
}

describe("createOpenAI.chat", () => {
  it("envía modelo, mensajes y herramientas con la clave", async () => {
    const { impl, calls } = fakeFetch({
      choices: [{ message: { role: "assistant", content: "Hola" } }],
      usage: { total_tokens: 42 },
    });
    const llm = createOpenAI({ apiKey: "KEY", model: "gpt-4o-mini" }, impl);
    const result = await llm.chat(
      [{ role: "user", content: "hola" }],
      [{ name: "get_menu", description: "Menú", parameters: { type: "object", properties: {} } }],
    );

    assert.equal(result.message.content, "Hola");
    assert.equal(result.tokens, 42);
    assert.match(calls[0]!.url, /\/v1\/chat\/completions$/);
    assert.equal((calls[0]!.init?.headers as Record<string, string>).Authorization, "Bearer KEY");
    const body = JSON.parse(String(calls[0]!.init?.body));
    assert.equal(body.model, "gpt-4o-mini");
    assert.equal(body.tools[0].function.name, "get_menu");
    assert.equal(body.messages[0].content, "hola");
  });

  it("no manda `tools` si no hay herramientas", async () => {
    const { impl, calls } = fakeFetch({ choices: [{ message: { content: "ok" } }] });
    await createOpenAI({ apiKey: "K", model: "m" }, impl).chat([{ role: "user", content: "x" }], []);
    assert.equal("tools" in JSON.parse(String(calls[0]!.init?.body)), false);
  });

  it("devuelve las llamadas a herramientas", async () => {
    const { impl } = fakeFetch({
      choices: [
        { message: { content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "get_menu", arguments: "{}" } }] } },
      ],
    });
    const { message } = await createOpenAI({ apiKey: "K", model: "m" }, impl).chat([{ role: "user", content: "x" }], []);
    assert.equal(message.tool_calls?.[0]?.function.name, "get_menu");
  });

  it("convierte los errores de la API en OpenAIError", async () => {
    const { impl } = fakeFetch({ error: { message: "Clave inválida" } }, 401);
    await assert.rejects(
      createOpenAI({ apiKey: "K", model: "m" }, impl).chat([{ role: "user", content: "x" }], []),
      (err: unknown) => err instanceof OpenAIError && err.status === 401 && /Clave inválida/.test(err.message),
    );
  });

  it("falla si la respuesta no trae mensaje", async () => {
    const { impl } = fakeFetch({ choices: [] });
    await assert.rejects(createOpenAI({ apiKey: "K", model: "m" }, impl).chat([{ role: "user", content: "x" }], []), OpenAIError);
  });
});

describe("createOpenAI.transcribe", () => {
  it("sube el audio como multipart y devuelve el texto", async () => {
    const { impl, calls } = fakeFetch({ text: "quiero una pizza" });
    const text = await createOpenAI({ apiKey: "K", model: "m" }, impl).transcribe(new Uint8Array([1, 2, 3]).buffer, "audio/ogg; codecs=opus");

    assert.equal(text, "quiero una pizza");
    assert.match(calls[0]!.url, /\/v1\/audio\/transcriptions$/);
    const form = calls[0]!.init?.body as FormData;
    assert.equal(form.get("model"), "gpt-4o-mini-transcribe");
    assert.equal(form.get("language"), "es");
    assert.ok(form.get("file") instanceof Blob);
  });
});

/** LLM de guion: devuelve las respuestas en orden y registra lo que recibió. */
function scriptedLlm(script: AssistantMessage[]): { llm: LLM; seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  let i = 0;
  const llm: LLM = {
    async chat(messages) {
      seen.push([...messages]);
      const message = script[Math.min(i++, script.length - 1)]!;
      return { message, tokens: 10 };
    },
  };
  return { llm, seen };
}

const call = (id: string, name: string, args: unknown) => ({
  id,
  type: "function" as const,
  function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) },
});

describe("runAgent", () => {
  const echo: AgentTool = {
    name: "echo",
    description: "Devuelve lo que recibe",
    parameters: { type: "object", properties: { text: { type: "string" } } },
    validate: (raw) => {
      const value = raw as { text?: unknown };
      if (typeof value.text !== "string") throw new Error("text es obligatorio");
      return { text: value.text };
    },
    run: async (args) => ({ echoed: (args as { text: string }).text }),
  };

  it("responde directo si el modelo no usa herramientas", async () => {
    const { llm } = scriptedLlm([{ role: "assistant", content: "Hola!" }]);
    const result = await runAgent({ llm, system: "sys", history: [{ role: "user", content: "hola" }], tools: [echo] });
    assert.equal(result.reply, "Hola!");
    assert.equal(result.tokens, 10);
  });

  it("ejecuta la herramienta y vuelve a llamar al modelo con el resultado", async () => {
    const { llm, seen } = scriptedLlm([
      { role: "assistant", content: null, tool_calls: [call("c1", "echo", { text: "hey" })] },
      { role: "assistant", content: "Listo: hey" },
    ]);
    const result = await runAgent({ llm, system: "sys", history: [{ role: "user", content: "x" }], tools: [echo] });

    assert.equal(result.reply, "Listo: hey");
    assert.equal(result.tokens, 20);
    const toolMsg = seen[1]!.find((m) => m.role === "tool");
    assert.deepEqual(toolMsg && JSON.parse(toolMsg.content), { echoed: "hey" });
  });

  it("devuelve el error al modelo si la herramienta no existe", async () => {
    const { llm, seen } = scriptedLlm([
      { role: "assistant", content: null, tool_calls: [call("c1", "borrar_todo", {})] },
      { role: "assistant", content: "No puedo" },
    ]);
    await runAgent({ llm, system: "sys", history: [], tools: [echo] });
    const toolMsg = seen[1]!.find((m) => m.role === "tool");
    assert.match(toolMsg!.content, /desconocida/i);
  });

  it("devuelve el error al modelo si los argumentos son inválidos o no son JSON", async () => {
    const { llm, seen } = scriptedLlm([
      { role: "assistant", content: null, tool_calls: [call("c1", "echo", {}), call("c2", "echo", "{no es json")] },
      { role: "assistant", content: "ok" },
    ]);
    await runAgent({ llm, system: "sys", history: [], tools: [echo] });
    const toolMsgs = seen[1]!.filter((m) => m.role === "tool");
    assert.equal(toolMsgs.length, 2);
    assert.match(toolMsgs[0]!.content, /text es obligatorio/);
    assert.match(toolMsgs[1]!.content, /JSON/);
  });

  it("captura las excepciones de una herramienta sin tumbar el turno", async () => {
    const boom: AgentTool = { ...echo, name: "boom", run: async () => { throw new Error("falló la base"); } };
    const { llm, seen } = scriptedLlm([
      { role: "assistant", content: null, tool_calls: [call("c1", "boom", { text: "x" })] },
      { role: "assistant", content: "Tuve un problema" },
    ]);
    const result = await runAgent({ llm, system: "sys", history: [], tools: [boom] });
    assert.equal(result.reply, "Tuve un problema");
    // El detalle interno (mensajes de la base, etc.) no le llega al modelo ni, por él, al cliente.
    const content = seen[1]!.find((m) => m.role === "tool")!.content;
    assert.doesNotMatch(content, /falló la base/);
    assert.match(content, /error/i);
  });

  it("no ejecuta más herramientas por paso ni por turno que el tope, pero responde a cada llamada", async () => {
    let runs = 0;
    const counted: AgentTool = { ...echo, run: async () => { runs += 1; return { ok: true }; } };
    const many = Array.from({ length: 12 }, (_, i) => call(`c${i}`, "echo", { text: "x" }));
    const { llm, seen } = scriptedLlm([
      { role: "assistant", content: null, tool_calls: many },
      { role: "assistant", content: null, tool_calls: many },
      { role: "assistant", content: "listo" },
    ]);
    const result = await runAgent({ llm, system: "sys", history: [], tools: [counted] });

    assert.equal(result.reply, "listo");
    assert.equal(runs, MAX_TOOL_CALLS_PER_TURN);
    // Toda tool_call necesita su respuesta `tool`, o la API de OpenAI rechaza el siguiente mensaje.
    const toolMsgs = seen[1]!.filter((m) => m.role === "tool");
    assert.equal(toolMsgs.length, 12);
    assert.match(toolMsgs.at(-1)!.content, /demasiadas/i);
  });

  it("corta tras el máximo de pasos y usa el mensaje de respaldo", async () => {
    const { llm } = scriptedLlm([{ role: "assistant", content: null, tool_calls: [call("c1", "echo", { text: "x" })] }]);
    const result = await runAgent({
      llm, system: "sys", history: [], tools: [echo], maxSteps: 3, fallbackReply: "Te paso con una persona",
    });
    assert.equal(result.reply, "Te paso con una persona");
    assert.equal(result.hitStepLimit, true);
  });

  it("no deja pasar una respuesta vacía", async () => {
    const { llm } = scriptedLlm([{ role: "assistant", content: "   " }]);
    const result = await runAgent({ llm, system: "sys", history: [], tools: [], fallbackReply: "Perdón, ¿me repetís?" });
    assert.equal(result.reply, "Perdón, ¿me repetís?");
  });
});
