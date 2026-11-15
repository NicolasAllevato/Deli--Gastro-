import { handleOrderWebhook, type Env } from "./handler.ts";

export type { Env };

/**
 * Worker de baja latencia: recibe eventos de pedidos firmados (HMAC) y los guarda.
 * DATA_BACKEND="d1" → binding D1 `DB` únicamente. Otro valor → Supabase vía PostgREST (legado).
 */
export default {
  fetch: (request: Request, env: Env): Promise<Response> => handleOrderWebhook(request, env),
};
