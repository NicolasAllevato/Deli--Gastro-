import type { AssistantMessage, ChatMessage, LLM, ToolCall } from "./types.ts";

/**
 * Modelo de juguete para el modo demo (sin clave de OpenAI ni internet): reconoce unas
 * pocas intenciones por palabras clave, usa las mismas herramientas que el agente real
 * y formatea el resultado. Sirve para ver el circuito completo, no para tomar pedidos.
 */

const call = (name: string, args: Record<string, unknown> = {}): ToolCall => ({
  id: `demo-${name}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const say = (content: string): AssistantMessage => ({ role: "assistant", content });
const askTool = (toolCall: ToolCall): AssistantMessage => ({ role: "assistant", content: null, tool_calls: [toolCall] });

const money = (n: number) => `$${Number(n).toLocaleString("es-AR")}`;

function parseResult(content: string): Record<string, unknown> & { error?: string } {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    return {};
  }
}

function explainToolResult(name: string, content: string): string {
  const data = parseResult(content);
  if (Array.isArray(data.value)) data.items = data.value;
  if (typeof data.error === "string") return `Uy, ${data.error}`;

  if (name === "get_menu") {
    const items = (JSON.parse(content) as Array<{ name: string; price: number }>).slice(0, 6);
    return `Hoy tenemos: ${items.map((p) => `${p.name} (${money(p.price)})`).join(", ")}. ¿Qué te gustaría pedir?`;
  }
  if (name === "get_business_info") {
    const hours = data.hours as { open: string; close: string };
    return data.open_now
      ? `Estamos abiertos de ${hours.open} a ${hours.close}. La demora ronda los ${String(data.estimated_minutes)} minutos.`
      : `Ahora estamos cerrados. Abrimos de ${hours.open} a ${hours.close}.`;
  }
  if (name === "order_status") {
    return data.found
      ? `Tu pedido ${String(data.order_code)} está "${String(data.status)}".`
      : "No encontré pedidos tuyos todavía.";
  }
  if (name === "handoff_to_human") return "Te paso con una persona del local, te responde enseguida.";
  return "Listo.";
}

export function createDemoLlm(): LLM {
  return {
    async chat(messages: readonly ChatMessage[]) {
      const last = messages[messages.length - 1];

      if (last?.role === "tool") {
        const asked = [...messages].reverse().find((m) => m.role === "assistant" && m.tool_calls?.length);
        const name = asked && asked.role === "assistant" ? (asked.tool_calls?.[0]?.function.name ?? "") : "";
        return { message: say(explainToolResult(name, last.content)), tokens: 0 };
      }

      const text = last?.role === "user" ? last.content.toLowerCase() : "";
      if (/persona|humano|queja|reclamo/.test(text)) return { message: askTool(call("handoff_to_human", { reason: text.slice(0, 200) })), tokens: 0 };
      if (/men[uú]|carta|qu[eé] (tienen|hay)/.test(text)) return { message: askTool(call("get_menu")), tokens: 0 };
      if (/horario|abiert|abren|cierran/.test(text)) return { message: askTool(call("get_business_info")), tokens: 0 };
      if (/pedido|estado|d[oó]nde est[aá]|demora/.test(text)) return { message: askTool(call("order_status")), tokens: 0 };

      return {
        message: say("¡Hola! Soy el asistente de demostración. Preguntame por el menú, el horario o el estado de tu pedido."),
        tokens: 0,
      };
    },
  };
}
