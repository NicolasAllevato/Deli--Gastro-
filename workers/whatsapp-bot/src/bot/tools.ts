import type { BotTool } from "../ai/responder.ts";
import { toolsForIntent } from "../guardrails.ts";
import type { BotConversation, BotRepo } from "../repo/bot.ts";
import { openNow, type BotSettings } from "./settings.ts";

const EMPTY = { type: "object", properties: {} };
const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Mercado Pago"];

const minutesSince = (date: Date, now: number): number => Math.max(0, Math.round((now - date.getTime()) / 60_000));

/** Herramientas de solo lectura y traspaso. Las de pedidos (quote/confirm/cancel) llegan en la fase 5. */
function allTools(repo: BotRepo, conversation: BotConversation, settings: BotSettings, now: () => number): BotTool[] {
  return [
    {
      name: "get_menu",
      description: "Productos disponibles con nombre, descripción, precio y categoría.",
      parameters: EMPTY,
      run: async () => (await repo.menu()).map(({ name, description, price, category }) => ({ name, description, price, category })),
    },
    {
      name: "get_business_info",
      description: "Horario, si el local está abierto, demora estimada, zonas de envío con tarifa y pedido mínimo, y formas de pago.",
      parameters: EMPTY,
      run: async () => ({
        business: settings.businessName,
        hours: settings.hours,
        open_now: openNow(settings, new Date(now())),
        estimated_minutes: settings.estimatedMinutes,
        zones: (await repo.zones()).map((z) => ({ name: z.name, delivery_fee: z.fee, min_order: z.minOrder })),
        payment_methods: PAYMENT_METHODS,
      }),
    },
    {
      name: "order_status",
      description: "Estado del último pedido del cliente de esta conversación.",
      parameters: EMPTY,
      run: async () => {
        // Siempre el cliente de ESTA conversación: el modelo no elige de quién es el pedido.
        const order = conversation.clientId ? await repo.latestOrder(conversation.clientId) : null;
        if (!order) return { found: false };
        return {
          found: true,
          order_code: `#${order.id.slice(0, 8).toUpperCase()}`,
          status: order.status,
          items: order.itemsDesc,
          total: order.total,
          courier: order.courierName,
          minutes_since_order: minutesSince(order.createdAt, now()),
        };
      },
    },
    {
      name: "handoff_to_human",
      description: "Deriva la conversación a una persona del local (queja o el cliente lo pide). El bot deja de responder.",
      parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] },
      run: async () => {
        await repo.setTakeover(conversation.id);
        return { ok: true, note: "Avisale al cliente que una persona del local le va a responder a la brevedad." };
      },
    },
  ];
}

/** Solo las herramientas que la intención permite (lista blanca de guardrails.ts). */
export function toolsFor(intent: string, repo: BotRepo, conversation: BotConversation, settings: BotSettings, now: () => number = Date.now): BotTool[] {
  const allowed = new Set(toolsForIntent(intent));
  return allTools(repo, conversation, settings, now).filter((t) => allowed.has(t.name));
}
