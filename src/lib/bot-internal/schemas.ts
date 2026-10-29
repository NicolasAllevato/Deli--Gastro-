import { z } from "zod";

/** Topes del borde. Los precios, totales y el cliente NUNCA vienen del Worker: se derivan en el servidor. */
export const MAX_LINES = 30;
export const MAX_QTY = 20;

const base = {
  conversationId: z.string().trim().min(1).max(64),
  /** wamid del mensaje entrante que se está respondiendo. */
  inboundWamid: z.string().trim().min(1).max(200),
};

const quoteLine = z.object({ product_id: z.string().trim().min(1).max(64), qty: z.number().int().min(1).max(MAX_QTY) }).strict();

// `.strict()`: un campo de más (clientId, price, total, rewardId…) es un 400, no se ignora en silencio.
export const quoteSchema = z
  .object({
    ...base,
    items: z.array(quoteLine).min(1).max(MAX_LINES),
    address: z.string().trim().min(5).max(200),
  })
  .strict();

export const confirmSchema = z
  .object({
    ...base,
    payment_method: z.string().trim().min(1).max(40),
    notes: z.string().trim().max(300).optional(),
  })
  .strict();

export const cancelSchema = z.object({ ...base, confirmed: z.boolean().optional() }).strict();

export const statusSchema = z.object(base).strict();

export type BotOperation = "quote" | "confirm" | "cancel" | "status";

export const SCHEMAS = { quote: quoteSchema, confirm: confirmSchema, cancel: cancelSchema, status: statusSchema } as const;
