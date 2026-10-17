import { z } from "zod";

/**
 * Borrador del pedido que arma el agente. Vive en `wa_conversations.state`, del lado
 * del servidor: los precios y el envío salen de `quote_order`, nunca de lo que el
 * modelo diga después. `confirm_order` solo crea lo que está acá.
 */
const draftSchema = z.object({
  items: z.array(z.object({ productId: z.string().min(1), qty: z.number().int().min(1).max(20) })).min(1).max(30),
  address: z.string().min(1).max(200),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  fee: z.number().finite().nonnegative(),
  subtotal: z.number().finite().nonnegative(),
  minOrder: z.number().finite().nonnegative(),
  /** Mensaje del cliente que disparó la cotización. */
  quotedByMessageId: z.string().min(1),
  /** Cuándo se cotizó (ISO): pasado el vencimiento hay que volver a cotizar. */
  quotedAt: z.string().min(1),
});

/** Una cotización más vieja que esto ya no se puede confirmar. */
export const DRAFT_TTL_MS = 30 * 60 * 1000;

export type OrderDraft = z.infer<typeof draftSchema>;

export function parseDraft(state: unknown): OrderDraft | null {
  if (typeof state !== "object" || state === null) return null;
  const parsed = draftSchema.safeParse((state as { draft?: unknown }).draft);
  return parsed.success ? parsed.data : null;
}

/** Copia del estado con el borrador reemplazado (o borrado con `null`). */
export function withDraft(state: unknown, draft: OrderDraft | null): Record<string, unknown> {
  const base = typeof state === "object" && state !== null ? (state as Record<string, unknown>) : {};
  const rest = Object.fromEntries(Object.entries(base).filter(([key]) => key !== "draft"));
  return draft ? { ...rest, draft } : rest;
}

export type ConfirmCheck = { ok: true; draft: OrderDraft } | { ok: false; reason: string };

/**
 * Un pedido solo se crea si el cliente respondió DESPUÉS de ver la cotización:
 * el turno que cotizó no puede ser el mismo que confirma.
 */
export function mayConfirm(draft: OrderDraft | null, currentMessageId: string, now: Date = new Date()): ConfirmCheck {
  if (!draft) return { ok: false, reason: "No hay un pedido cotizado. Usá quote_order primero." };
  if (now.getTime() - new Date(draft.quotedAt).getTime() > DRAFT_TTL_MS) {
    return { ok: false, reason: "La cotización venció. Volvé a cotizar el pedido con quote_order." };
  }
  if (draft.quotedByMessageId === currentMessageId) {
    return {
      ok: false,
      reason: "El cliente todavía no confirmó. Mostrale el resumen con el total y esperá su respuesta.",
    };
  }
  return { ok: true, draft };
}
