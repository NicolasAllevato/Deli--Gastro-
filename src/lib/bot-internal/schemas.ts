import { z } from "zod";

/** Topes del borde. Los precios, totales y el cliente NUNCA vienen del Worker: se derivan en el servidor. */
export const MAX_LINES = 30;
export const MAX_QTY = 20;

const base = {
  conversationId: z.string().trim().min(1).max(64),
  /** wamid del mensaje entrante que se está respondiendo. */
  inboundWamid: z.string().trim().min(1).max(200),
};

/** Sin caracteres de control (salvo saltos de línea) y con a lo sumo un renglón en blanco seguido. */
export function cleanNotes(raw: string): string {
  const text = raw.replace(/\r\n?/g, "\n").replace(/\t/g, " ");
  // U+200D (ZWJ) y U+FE0F (VS16) se conservan: sin ellos se rompen los emojis compuestos.
  const keep = (ch: string) => ch === "\n" || ch === "‍" || ch === "️" || !/\p{C}/u.test(ch);
  const printable = Array.from(text).filter(keep).join("");
  return printable.replace(/\n{3,}/g, "\n\n").trim();
}

const quoteLine = z.object({ product_id: z.string().uuid(), qty: z.number().int().min(1).max(MAX_QTY) }).strict();

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
    notes: z.string().max(600).transform(cleanNotes).pipe(z.string().max(300)).optional(),
  })
  .strict();

export const cancelSchema = z.object({ ...base, confirmed: z.boolean().optional() }).strict();

export const statusSchema = z.object(base).strict();

export type BotOperation = "quote" | "confirm" | "cancel" | "status";

export const SCHEMAS = { quote: quoteSchema, confirm: confirmSchema, cancel: cancelSchema, status: statusSchema } as const;
