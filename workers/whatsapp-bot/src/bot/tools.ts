import type { BotTool } from "../ai/responder.ts";
import { toolsForIntent } from "../guardrails.ts";
import type { BotConversation, BotRepo } from "../repo/types.ts";
import { openNow, type BotSettings } from "./settings.ts";
import { runCancel, runConfirm, runQuote, runStatus, type OrderTurn } from "../orders/flow.ts";

const EMPTY = { type: "object", properties: {} };
const PAYMENT_METHODS = ["Efectivo", "Transferencia", "Mercado Pago"];

const minutesSince = (date: Date, now: number): number => Math.max(0, Math.round((now - date.getTime()) / 60_000));

const OBJECT_NO_EXTRA = (properties: Record<string, unknown>, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });

/**
 * Herramientas de pedidos (fase 5, solo con el flag encendido). El modelo no manda precios, totales, cliente,
 * wamid ni conversación: los fija el turno. El texto que ve el cliente sale de plantillas (orders/flow.ts).
 */
function orderTools(order: OrderTurn): BotTool[] {
  return [
    {
      name: "quote_order",
      description: "Cotiza el pedido con productos (product_id de get_menu y cantidad) y la dirección de entrega. El resumen con el total se le envía solo al cliente.",
      parameters: OBJECT_NO_EXTRA(
        {
          items: { type: "array", minItems: 1, maxItems: 30, items: OBJECT_NO_EXTRA({ product_id: { type: "string" }, qty: { type: "integer", minimum: 1, maximum: 20 } }, ["product_id", "qty"]) },
          address: { type: "string", minLength: 5, maxLength: 200 },
        },
        ["items", "address"],
      ),
      run: (args) => runQuote(order, args),
    },
    {
      name: "confirm_order",
      description: "Confirma el pedido cotizado y genera el link de pago. Solo funciona si el cliente respondió SÍ al resumen. Solo Mercado Pago.",
      parameters: OBJECT_NO_EXTRA({ payment_method: { type: "string", enum: ["Mercado Pago"] }, notes: { type: "string", maxLength: 300 } }, ["payment_method"]),
      run: (args) => runConfirm(order, args),
    },
    {
      name: "cancel_order",
      description: "Cancela el pedido en curso (solo si está en Recibidos). Primero se le pregunta al cliente; confirmed:true solo después de que responda SÍ a esa pregunta.",
      parameters: OBJECT_NO_EXTRA({ confirmed: { type: "boolean" } }, ["confirmed"]),
      run: (args) => runCancel(order, args),
    },
  ];
}

/** Herramientas de solo lectura y traspaso; con el flag de pedidos, `get_menu` incluye el id y `order_status` va por la app. */
function allTools(repo: BotRepo, conversation: BotConversation, settings: BotSettings, now: () => number, order?: OrderTurn): BotTool[] {
  return [
    {
      name: "get_menu",
      description: "Productos disponibles con nombre, descripción, precio y categoría.",
      parameters: EMPTY,
      run: async () =>
        (await repo.menu()).map(({ id, name, description, price, category }) => (order ? { id, name, description, price, category } : { name, description, price, category })),
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
        if (order) return runStatus(order);
        // Siempre el cliente de ESTA conversación: el modelo no elige de quién es el pedido.
        const latest = conversation.clientId ? await repo.latestOrder(conversation.clientId) : null;
        if (!latest) return { found: false };
        return {
          found: true,
          order_code: `#${latest.id.slice(0, 8).toUpperCase()}`,
          status: latest.status,
          items: latest.itemsDesc,
          total: latest.total,
          courier: latest.courierName,
          minutes_since_order: minutesSince(latest.createdAt, now()),
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
    ...(order ? orderTools(order) : []),
  ];
}

/** Solo las herramientas que la intención permite (lista blanca de guardrails.ts). Sin `order` (flag apagado) no existen las de pedidos. */
export function toolsFor(intent: string, repo: BotRepo, conversation: BotConversation, settings: BotSettings, now: () => number = Date.now, order?: OrderTurn): BotTool[] {
  const allowed = new Set(toolsForIntent(intent));
  return allTools(repo, conversation, settings, now, order).filter((t) => allowed.has(t.name));
}
