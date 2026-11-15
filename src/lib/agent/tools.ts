import { z } from "zod";
import { isPortalVisible } from "@/lib/catalog/visibility";
import { createAdminClient } from "@/utils/supabase/admin";
import type { Database } from "@/types/database";
import { PAYMENT_METHODS } from "@/lib/orders";
import { getGateway } from "@/lib/payments/gateway";
import { loadDeliverySettings } from "@/lib/zones-server";
import type { AgentTool } from "./loop.ts";
import { isOpenNow } from "./hours.ts";
import { cancelOrder, confirmOrder, customerInfo, orderStatus, quoteOrder, type OrderActionDeps } from "./order-actions.ts";
import { loadAgentSettings } from "./settings.ts";

type Db = ReturnType<typeof createAdminClient>;
type Conversation = Database["public"]["Tables"]["wa_conversations"]["Row"];

export interface ToolContext {
  db: Db;
  conversation: Conversation;
  /** Mensaje entrante que se está respondiendo (para la guardia de confirmación). */
  messageId: string;
  /** Prueba del panel: lee todo pero no crea ni cancela pedidos ni deriva la conversación. */
  dryRun: boolean;
}

const MENU_LIMIT = 80;

const EMPTY_SCHEMA = { type: "object", properties: {}, additionalProperties: false } as const;

function defineTool<S extends z.ZodType>(spec: {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  schema: S;
  run: (args: z.infer<S>) => Promise<unknown>;
}): AgentTool {
  return {
    name: spec.name,
    description: spec.description,
    parameters: spec.parameters,
    validate: (raw) => spec.schema.parse(raw),
    run: (args) => spec.run(args as z.infer<S>),
  };
}

const quoteSchema = z.object({
  items: z
    .array(z.object({ product_id: z.string().min(1), qty: z.number().int().min(1).max(20) }))
    .min(1)
    .max(30),
  address: z.string().trim().min(5).max(200),
});

const confirmSchema = z.object({
  payment_method: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(300).optional(),
});

const handoffSchema = z.object({ reason: z.string().trim().min(1).max(300) });

export function buildTools(ctx: ToolContext): AgentTool[] {
  const { db } = ctx;
  const actions: OrderActionDeps = ctx;

  return [
    defineTool({
      name: "get_menu",
      description: "Lista los productos disponibles con id, nombre, descripción, precio y categoría.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: async () => {
        const [{ data: products }, { data: categories }] = await Promise.all([
          db.from("products").select("*").eq("is_active", true).limit(MENU_LIMIT),
          db.from("categories").select("id, name"),
        ]);
        const names = new Map((categories ?? []).map((c) => [c.id, c.name]));
        return (products ?? []).filter(isPortalVisible).map((p) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          price: Number(p.price),
          category: (p.category_id && names.get(p.category_id)) || "Otros",
        }));
      },
    }),

    defineTool({
      name: "get_business_info",
      description: "Horario, si el local está abierto ahora, demora estimada, zonas de entrega con su tarifa y formas de pago.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: async () => {
        const [settings, delivery] = await Promise.all([loadAgentSettings(db), loadDeliverySettings(db)]);
        return {
          business: settings.businessName,
          hours: settings.hours,
          open_now: !settings.paused && isOpenNow(settings.hours.open, settings.hours.close),
          paused: settings.paused,
          estimated_minutes: settings.estimatedMinutes,
          zones: delivery.zones
            .filter((z) => z.is_active)
            .map((z) => ({ name: z.name, delivery_fee: z.fee, min_order: z.min_order })),
          payment_methods: PAYMENT_METHODS.filter((m) => m !== "Mercado Pago" || getGateway() !== null),
        };
      },
    }),

    defineTool({
      name: "get_customer",
      description: "Datos del cliente de esta conversación: nombre, dirección guardada y sus últimos pedidos.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: () => customerInfo(actions),
    }),

    defineTool({
      name: "quote_order",
      description:
        "Cotiza un pedido: valida productos, ubica la dirección, verifica cobertura y calcula subtotal, envío y total. Guarda el borrador. Usá los ids de get_menu.",
      parameters: {
        type: "object",
        properties: {
          items: {
            type: "array",
            items: {
              type: "object",
              properties: { product_id: { type: "string" }, qty: { type: "integer", minimum: 1 } },
              required: ["product_id", "qty"],
            },
          },
          address: { type: "string", description: "Calle, altura y barrio de entrega" },
        },
        required: ["items", "address"],
      },
      schema: quoteSchema,
      run: (args) => quoteOrder(actions, args),
    }),

    defineTool({
      name: "confirm_order",
      description:
        "Crea el pedido cotizado. Solo usalo cuando el cliente ya confirmó en un mensaje posterior a la cotización. Requiere la forma de pago.",
      parameters: {
        type: "object",
        properties: {
          payment_method: { type: "string", enum: [...PAYMENT_METHODS] },
          notes: { type: "string", description: "Aclaraciones del cliente (opcional)" },
        },
        required: ["payment_method"],
      },
      schema: confirmSchema,
      run: (args) => confirmOrder(actions, args),
    }),

    defineTool({
      name: "order_status",
      description: "Estado del último pedido del cliente.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: () => orderStatus(actions),
    }),

    defineTool({
      name: "cancel_order",
      description: "Cancela el último pedido del cliente si todavía se puede (recién recibido y dentro del plazo).",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: () => cancelOrder(actions),
    }),

    defineTool({
      name: "handoff_to_human",
      description: "Deriva la conversación a una persona del local (queja, pedido complejo o el cliente lo pide). El agente deja de responder.",
      parameters: {
        type: "object",
        properties: { reason: { type: "string" } },
        required: ["reason"],
      },
      schema: handoffSchema,
      run: async () => {
        if (!ctx.dryRun) {
          await db.from("wa_conversations").update({ human_takeover: true }).eq("id", ctx.conversation.id);
        }
        return { ok: true, note: "Avisale al cliente que una persona del local le va a responder a la brevedad." };
      },
    }),
  ];
}
