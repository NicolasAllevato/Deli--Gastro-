import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import type { Database, Json } from "@/types/database";
import { isDemoMode } from "@/lib/demo/mode";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import { minutesSince, PAYMENT_METHODS } from "@/lib/orders";
import { cancelOrderForClient, createDeliveryOrder, priceOrder } from "@/lib/orders-create";
import { SAMPLE_ADDRESSES } from "@/lib/restaurant";
import { ensureClientForConversation } from "@/lib/whatsapp/clients";
import { loadDeliverySettings } from "@/lib/zones-server";
import type { AgentTool } from "./loop.ts";
import { mayConfirm, parseDraft, withDraft } from "./draft.ts";
import { isOpenNow } from "./hours.ts";
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
const HISTORY_ORDERS = 3;

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

/** En el demo no hay internet: se busca entre las direcciones de ejemplo. */
function demoGeocode(query: string): GeocodeResult[] {
  const words = query.toLowerCase().split(/[\s,]+/).filter((w) => w.length >= 4);
  return SAMPLE_ADDRESSES.filter((a) => {
    const haystack = `${a.label} ${a.address}`.toLowerCase();
    return haystack.includes(query.toLowerCase()) || words.some((w) => haystack.includes(w));
  }).map((a) => ({ label: a.address, lat: a.lat, lng: a.lng }));
}

/** El servidor, no el modelo, decide si se pueden tomar pedidos: cerrado o en pausa = no. */
async function closedReason(db: Db): Promise<string | null> {
  const settings = await loadAgentSettings(db);
  if (settings.paused) return "El local pausó los pedidos por ahora.";
  if (!isOpenNow(settings.hours.open, settings.hours.close)) {
    return `El local está cerrado. Abre de ${settings.hours.open} a ${settings.hours.close}.`;
  }
  return null;
}

async function reloadConversation(ctx: ToolContext): Promise<Conversation> {
  const { data } = await ctx.db.from("wa_conversations").select("*").eq("id", ctx.conversation.id).maybeSingle();
  return data ?? ctx.conversation;
}

async function latestOrder(ctx: ToolContext, clientId: string | null) {
  if (!clientId) return null;
  const { data } = await ctx.db
    .from("orders")
    .select("id, status, items_desc, total, courier_name, created_at")
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(1);
  return data?.[0] ?? null;
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

  return [
    defineTool({
      name: "get_menu",
      description: "Lista los productos disponibles con id, nombre, descripción, precio y categoría.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: async () => {
        const [{ data: products }, { data: categories }] = await Promise.all([
          db.from("products").select("id, name, description, price, category_id").eq("is_active", true).limit(MENU_LIMIT),
          db.from("categories").select("id, name"),
        ]);
        const names = new Map((categories ?? []).map((c) => [c.id, c.name]));
        return (products ?? []).map((p) => ({
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
          payment_methods: PAYMENT_METHODS,
        };
      },
    }),

    defineTool({
      name: "get_customer",
      description: "Datos del cliente de esta conversación: nombre, dirección guardada y sus últimos pedidos.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: async () => {
        const conversation = await reloadConversation(ctx);
        if (!conversation.client_id) return { known: false, name: conversation.contact_name };
        const [{ data: client }, { data: orders }] = await Promise.all([
          db.from("clients").select("name, address").eq("id", conversation.client_id).maybeSingle(),
          db
            .from("orders")
            .select("items_desc, total, status, created_at")
            .eq("client_id", conversation.client_id)
            .order("created_at", { ascending: false })
            .limit(HISTORY_ORDERS),
        ]);
        return { known: true, name: client?.name ?? conversation.contact_name, saved_address: client?.address ?? null, recent_orders: orders ?? [] };
      },
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
      run: async (args) => {
        const closed = await closedReason(db);
        if (closed) return { error: closed };
        const conversation = await reloadConversation(ctx);
        const local = (await loadDeliverySettings(db)).quoteOptions.local;
        const found = isDemoMode() ? demoGeocode(args.address) : await geocodeAddress(args.address, local).catch(() => []);
        const place = found[0];
        if (!place) return { error: "No encontré esa dirección. Pedile calle, altura y barrio." };

        const items = args.items.map((i) => ({ productId: i.product_id, qty: i.qty }));
        const priced = await priceOrder(db, items, { address: place.label, lat: place.lat, lng: place.lng });
        if (!priced.ok) return { error: priced.message };

        const { lines, subtotal, fee, minOrder, zone } = priced.value;
        const draft = {
          items: lines.map((l) => ({ productId: l.productId, qty: l.qty })),
          address: place.label.slice(0, 200),
          lat: place.lat,
          lng: place.lng,
          fee,
          subtotal,
          minOrder,
          quotedByMessageId: ctx.messageId,
          quotedAt: new Date().toISOString(),
        };
        await db.from("wa_conversations").update({ state: withDraft(conversation.state, draft) as Json }).eq("id", conversation.id);

        return {
          lines: lines.map((l) => ({ name: l.name, qty: l.qty, price: l.price })),
          subtotal,
          delivery_fee: fee,
          total: subtotal + fee,
          zone,
          resolved_address: place.label,
          note: "Mostrale el resumen y preguntale si confirma. No crees el pedido hasta su respuesta.",
        };
      },
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
      run: async (args) => {
        const closed = await closedReason(db);
        if (closed) return { error: closed };
        const conversation = await reloadConversation(ctx);
        const check = mayConfirm(parseDraft(conversation.state), ctx.messageId);
        if (!check.ok) return { error: check.reason };
        if (ctx.dryRun) return { ok: true, dry_run: true, note: "Prueba: el pedido no se creó." };

        const { draft } = check;

        // Se reclama el borrador ANTES de crear el pedido: si dos "sí" llegan a la vez, solo uno
        // logra el update (el otro ve otro `updated_at`) y el segundo no crea un pedido duplicado.
        const { data: claimed } = await db
          .from("wa_conversations")
          .update({ state: withDraft(conversation.state, null) as Json })
          .eq("id", conversation.id)
          .eq("updated_at", conversation.updated_at)
          .select("id")
          .maybeSingle();
        if (!claimed) return { error: "Ya se está procesando tu confirmación. Esperá un momento." };

        const created = await createDeliveryOrder(db, {
          clientId: await ensureClientForConversation(db, conversation),
          items: draft.items,
          address: { address: draft.address, lat: draft.lat, lng: draft.lng },
          paymentMethod: args.payment_method,
          notes: args.notes,
          channel: "whatsapp",
          actor: "agente",
          expectedTotal: draft.subtotal + draft.fee,
        });
        if (!created.ok) {
          // No se creó: se devuelve el borrador para poder reintentar o recotizar.
          await db.from("wa_conversations").update({ state: withDraft(conversation.state, draft) as Json }).eq("id", conversation.id);
          return { error: created.message };
        }

        return {
          ok: true,
          order_code: `#${created.value.id.slice(0, 8).toUpperCase()}`,
          total: Number(created.value.total),
          payment_method: args.payment_method,
        };
      },
    }),

    defineTool({
      name: "order_status",
      description: "Estado del último pedido del cliente.",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: async () => {
        const order = await latestOrder(ctx, (await reloadConversation(ctx)).client_id);
        if (!order) return { found: false };
        return {
          found: true,
          order_code: `#${order.id.slice(0, 8).toUpperCase()}`,
          status: order.status,
          items: order.items_desc,
          total: Number(order.total),
          courier: order.courier_name,
          minutes_since_order: minutesSince(order.created_at),
        };
      },
    }),

    defineTool({
      name: "cancel_order",
      description: "Cancela el último pedido del cliente si todavía se puede (recién recibido y dentro del plazo).",
      parameters: EMPTY_SCHEMA,
      schema: z.object({}),
      run: async () => {
        const conversation = await reloadConversation(ctx);
        const order = await latestOrder(ctx, conversation.client_id);
        if (!order || !conversation.client_id) return { error: "No encontré un pedido para cancelar." };
        if (ctx.dryRun) return { ok: true, dry_run: true, note: "Prueba: el pedido no se canceló." };

        const result = await cancelOrderForClient(db, order.id, conversation.client_id, "agente");
        return result.ok ? { ok: true } : { error: result.message };
      },
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
