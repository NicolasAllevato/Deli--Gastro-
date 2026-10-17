import type { AssistantMessage, ChatMessage, LLM, ToolCall } from "../agent/types.ts";
import type { RangeKey } from "./range.ts";

/**
 * Analista de juguete para el modo demo (sin clave de OpenAI): reconoce la intención por
 * palabras clave, consulta las mismas herramientas que el modelo real y redacta el resultado.
 */

/** "ventas de ayer" → yesterday. Sin pista de período, los últimos 7 días. */
export function detectRange(text: string): RangeKey {
  const t = text.toLowerCase();
  if (/mes pasado|mes anterior/.test(t)) return "last_month";
  if (/\b30\b|treinta/.test(t)) return "last_30_days";
  if (/este mes|del mes|mensual/.test(t)) return "this_month";
  if (/ayer/.test(t)) return "yesterday";
  if (/\bhoy\b/.test(t)) return "today";
  return "last_7_days";
}

const call = (name: string, args: Record<string, unknown>): ToolCall => ({
  id: `demo-${name}`,
  type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

const say = (content: string): AssistantMessage => ({ role: "assistant", content });
const askTool = (toolCall: ToolCall): AssistantMessage => ({ role: "assistant", content: null, tool_calls: [toolCall] });

const money = (n: number) => `$${Math.round(n).toLocaleString("es-AR")}`;
const minutes = (n: unknown) => (typeof n === "number" ? `${n} min` : "sin datos");

type Data = Record<string, unknown> & { period?: string };

function explain(name: string, data: Data): string {
  const period = data.period ?? "el período";

  switch (name) {
    case "get_sales_summary": {
      if (!data.orders) return `${period}: no hubo ventas.`;
      return [
        `${period}:`,
        `- Ventas: ${money(Number(data.revenue))} en ${String(data.orders)} pedidos`,
        `- Ticket promedio: ${money(Number(data.avgTicket))}`,
        `- Cancelados: ${String(data.cancelled)} (${Math.round(Number(data.cancellationRate) * 100)}%)`,
      ].join("\n");
    }
    case "get_top_products": {
      const products = (data.products as Array<{ name: string; units: number }>) ?? [];
      if (products.length === 0) return `${period}: no hay ventas de productos.`;
      return `Lo más pedido (${period}):\n${products.map((p) => `- ${p.name}: ${p.units} u.`).join("\n")}`;
    }
    case "get_recurring_customers": {
      const customers = (data.customers as Array<{ name: string; orders: number; spent: number }>) ?? [];
      if (customers.length === 0) return `${period}: ningún cliente repitió pedido.`;
      return `Clientes recurrentes (${period}):\n${customers
        .slice(0, 5).map((c) => `- ${c.name}: ${c.orders} pedidos, ${money(c.spent)}`).join("\n")}`;
    }
    case "get_new_vs_returning":
      return `${period}: ${String(data.newCustomers)} clientes nuevos y ${String(data.returningCustomers)} que ya habían pedido antes.`;
    case "get_delivery_times":
      return [
        `Tiempos medios (${period}, ${String(data.delivered)} entregas):`,
        `- Cocina: ${minutes(data.avgKitchen)}`,
        `- Espera de despacho: ${minutes(data.avgDispatchWait)}`,
        `- En ruta: ${minutes(data.avgRoute)}`,
        `- Total: ${minutes(data.avgTotal)}`,
      ].join("\n");
    case "get_reviews_summary":
      return data.count
        ? `${period}: ${String(data.count)} reseñas, promedio ${String(data.average)} estrellas (${String(data.lowRated)} bajas).`
        : `${period}: no hubo reseñas.`;
    default:
      return "Listo.";
  }
}

const HELP =
  "Soy el analista de demostración. Preguntame por ventas, productos más vendidos, clientes recurrentes, clientes nuevos, tiempos de entrega o reseñas (por ejemplo: “ventas de ayer”).";

export function createDemoReportsLlm(): LLM {
  return {
    async chat(messages: readonly ChatMessage[]) {
      const last = messages[messages.length - 1];

      if (last?.role === "tool") {
        const asked = [...messages].reverse().find((m) => m.role === "assistant" && m.tool_calls?.length);
        const name = asked && asked.role === "assistant" ? (asked.tool_calls?.[0]?.function.name ?? "") : "";
        let data: Data = {};
        try {
          data = JSON.parse(last.content) as Data;
        } catch {
          /* resultado ilegible: se responde con el texto genérico */
        }
        return { message: say(explain(name, data)), tokens: 0 };
      }

      const text = last?.role === "user" ? last.content : "";
      const range = detectRange(text);
      const t = text.toLowerCase();

      if (/recurrent|frecuente|fiel|repit/.test(t)) return { message: askTool(call("get_recurring_customers", { range })), tokens: 0 };
      if (/nuevo|retorn|volvier/.test(t)) return { message: askTool(call("get_new_vs_returning", { range })), tokens: 0 };
      if (/producto|vendid|m[aá]s pedid|top/.test(t)) return { message: askTool(call("get_top_products", { range })), tokens: 0 };
      if (/demora|tiempo|entrega|cocina/.test(t)) return { message: askTool(call("get_delivery_times", { range })), tokens: 0 };
      if (/rese[ñn]a|calific|satisf|estrella/.test(t)) return { message: askTool(call("get_reviews_summary", { range })), tokens: 0 };
      if (/vend[ií]|venta|factur|ingres|pedidos|ticket|promedio/.test(t)) return { message: askTool(call("get_sales_summary", { range })), tokens: 0 };
      return { message: say(HELP), tokens: 0 };
    },
  };
}
