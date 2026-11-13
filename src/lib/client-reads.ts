import type { createAdminClient } from "@/utils/supabase/admin";
import { comparableClientOrder, dataFor, shadowRead, type Actor } from "@/lib/data";

/**
 * Lecturas del portal cliente con sombra D1 (fase 2, tanda 3).
 * Con DATA_BACKEND=supabase solo consulta Supabase, igual que antes. En dual
 * compara con D1 sin cambiar la respuesta. Supabase filtra por `clientId`
 * (resuelto desde la sesión por requireClient/requireClientPage) y D1 por el
 * user_id del actor: si alguna vez no coincidieran, la sombra lo registra.
 */
type Db = ReturnType<typeof createAdminClient>;

export interface ClientContext {
  db: Db;
  userId: string;
  clientId: string;
}

const actorOf = (ctx: ClientContext): Actor => ({ kind: "cliente", userId: ctx.userId });
const byId = (r: Record<string, unknown>) => String(r.id);
const same = (r: Record<string, unknown>) => r;

async function rows<T>(q: PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

/** Para páginas: ante un error de lectura muestra el valor vacío (como antes) y lo deja en el log. */
export async function orFallback<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (err) {
    console.error("[client] lectura", err instanceof Error ? err.message : err);
    return fallback;
  }
}

/** Pedidos propios, más recientes primero (máx. 50). */
export async function clientOrders(ctx: ClientContext) {
  return shadowRead(
    () => rows(ctx.db.from("orders").select("*").eq("client_id", ctx.clientId).order("created_at", { ascending: false }).limit(50)),
    async () => (await dataFor(actorOf(ctx))).clientViews.orders(50),
    { op: "client.orders", normalize: (r) => comparableClientOrder(r as never), normalizeShadow: (r) => comparableClientOrder(r as never), key: byId },
  );
}

/** Un pedido propio, o null. */
export async function clientOrder(ctx: ClientContext, orderId: string) {
  const [order] = await shadowRead(
    async () => {
      const { data, error } = await ctx.db.from("orders").select("*").eq("id", orderId).eq("client_id", ctx.clientId).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? [data] : [];
    },
    async () => {
      const o = await (await dataFor(actorOf(ctx))).clientViews.order(orderId);
      return o ? [o] : [];
    },
    { op: "client.order", normalize: (r) => comparableClientOrder(r as never), normalizeShadow: (r) => comparableClientOrder(r as never), key: byId },
  );
  return order ?? null;
}

/** Ids de pedidos propios ya reseñados. */
export async function clientReviewedOrderIds(ctx: ClientContext): Promise<Set<string>> {
  const list = await shadowRead(
    async () => (await rows(ctx.db.from("reviews").select("order_id").eq("client_id", ctx.clientId))).map((r) => ({ id: r.order_id })),
    async () => (await dataFor(actorOf(ctx))).clientViews.reviewedOrderIds(),
    { op: "client.reviewed", normalize: same, normalizeShadow: same, key: byId },
  );
  return new Set(list.map((r) => r.id));
}

/** Últimos movimientos de puntos propios. */
export async function clientLedger(ctx: ClientContext, limit = 10) {
  return shadowRead(
    () =>
      rows(
        ctx.db.from("points_ledger").select("id, delta, description, created_at").eq("client_id", ctx.clientId)
          .order("created_at", { ascending: false }).limit(limit),
      ),
    async () => (await dataFor(actorOf(ctx))).clientViews.ledger(limit),
    {
      op: "client.ledger",
      normalize: ({ id, delta, description }) => ({ id, delta, description }),
      normalizeShadow: ({ id, delta, description }) => ({ id, delta, description }),
      key: byId,
    },
  );
}

/** Puntos acreditados por pedido propio (solo asientos positivos). */
export async function clientEarnedByOrder(ctx: ClientContext): Promise<Map<string, number>> {
  const list = await shadowRead(
    async () => {
      const ledger = await rows(ctx.db.from("points_ledger").select("order_id, delta").eq("client_id", ctx.clientId).gt("delta", 0));
      const sums = new Map<string, number>();
      for (const r of ledger) if (r.order_id) sums.set(r.order_id, (sums.get(r.order_id) ?? 0) + r.delta);
      return [...sums].map(([id, delta]) => ({ id, delta }));
    },
    async () => (await dataFor(actorOf(ctx))).clientViews.earnedByOrder(),
    { op: "client.earned", normalize: same, normalizeShadow: same, key: byId },
  );
  return new Map(list.map((r) => [r.id, r.delta]));
}
