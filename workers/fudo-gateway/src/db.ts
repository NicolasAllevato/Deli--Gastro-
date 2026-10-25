import type { FudoMaps, OrderForFudo } from "./payload";

/** Acceso a Supabase por PostgREST con la service role (igual que pedidos-webhook). */
export interface DbEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}

async function rest<T>(env: DbEnv, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      prefer: "return=representation",
      ...init.headers,
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

export const MAX_ATTEMPTS = 6;

interface OrderRow {
  id: string;
  total: number | string;
  delivery_fee: number | string;
  delivery_address: string | null;
  payment_method: string | null;
  notes: string | null;
  fudo_order_id: number | null;
  fudo_attempts: number;
  clients: { name: string; phone: string | null } | null;
  order_items: Array<{ product_id: string | null; name: string; qty: number; unit_price: number | string }>;
}

export interface ClaimedOrder {
  order: OrderForFudo;
  attempts: number;
}

/**
 * Toma el pedido para enviarlo: sube `fudo_attempts` solo si nadie lo tomó antes (mismo valor leído)
 * y todavía no tiene `fudo_order_id`. Así el cron y el pedido directo de la app no lo mandan dos veces.
 */
export async function claimOrder(env: DbEnv, orderId: string): Promise<ClaimedOrder | null> {
  const select = "id,total,delivery_fee,delivery_address,payment_method,notes,fudo_order_id,fudo_attempts,clients(name,phone),order_items(product_id,name,qty,unit_price)";
  const [row] = await rest<OrderRow[]>(
    env,
    `orders?id=eq.${encodeURIComponent(orderId)}&fudo_sync_status=in.(pending,failed)&fudo_order_id=is.null&select=${select}`,
  );
  if (!row || row.fudo_attempts >= MAX_ATTEMPTS) return null;

  const claimed = await rest<unknown[]>(
    env,
    `orders?id=eq.${row.id}&fudo_attempts=eq.${row.fudo_attempts}&fudo_order_id=is.null`,
    { method: "PATCH", body: JSON.stringify({ fudo_attempts: row.fudo_attempts + 1 }) },
  );
  if (claimed.length === 0) return null;

  return {
    attempts: row.fudo_attempts + 1,
    order: {
      id: row.id,
      total: Number(row.total),
      delivery_fee: Number(row.delivery_fee),
      delivery_address: row.delivery_address,
      payment_method: row.payment_method,
      notes: row.notes,
      client: row.clients,
      items: row.order_items.map((i) => ({ ...i, unit_price: Number(i.unit_price) })),
    },
  };
}

export async function loadMaps(env: DbEnv): Promise<FudoMaps> {
  const [products, payments] = await Promise.all([
    rest<Array<{ product_id: string; fudo_product_id: number }>>(env, "fudo_product_map?select=product_id,fudo_product_id"),
    rest<Array<{ payment_method: string; fudo_payment_method_id: number }>>(env, "fudo_payment_map?select=payment_method,fudo_payment_method_id"),
  ]);
  return {
    products: new Map(products.map((p) => [p.product_id, p.fudo_product_id])),
    payments: new Map(payments.map((p) => [p.payment_method, p.fudo_payment_method_id])),
  };
}

export async function markSent(env: DbEnv, orderId: string, fudoOrderId: number): Promise<void> {
  await rest(env, `orders?id=eq.${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ fudo_order_id: fudoOrderId, fudo_sync_status: "sent", fudo_error: null, fudo_synced_at: new Date().toISOString() }),
  });
  await logEvent(env, orderId, "fudo_enviado", String(fudoOrderId));
}

export async function markFailed(env: DbEnv, orderId: string, error: string, permanent: boolean): Promise<void> {
  // `skipped` = no se reintenta (falta mapeo o Fudo rechazó el cuerpo); se corrige y se vuelve a `pending` a mano.
  await rest(env, `orders?id=eq.${orderId}`, {
    method: "PATCH",
    body: JSON.stringify({ fudo_sync_status: permanent ? "skipped" : "failed", fudo_error: error.slice(0, 500) }),
  });
  await logEvent(env, orderId, permanent ? "fudo_rechazado" : "fudo_error", error.slice(0, 200));
}

async function logEvent(env: DbEnv, orderId: string, event: string, detail: string): Promise<void> {
  try {
    await rest(env, "order_events", {
      method: "POST",
      headers: { prefer: "return=minimal" },
      body: JSON.stringify({ order_id: orderId, event, actor: "fudo", detail }),
    });
  } catch {
    // La bitácora no debe cambiar el resultado del envío.
  }
}

/** Pendientes y fallidos para el cron: los de más de 1 minuto (el envío directo ya tuvo su oportunidad). */
export async function listRetryable(env: DbEnv, limit = 20): Promise<string[]> {
  const before = new Date(Date.now() - 60_000).toISOString();
  const rows = await rest<Array<{ id: string }>>(
    env,
    `orders?fudo_sync_status=in.(pending,failed)&fudo_order_id=is.null&fudo_attempts=lt.${MAX_ATTEMPTS}&created_at=lt.${before}&select=id&order=created_at.asc&limit=${limit}`,
  );
  return rows.map((r) => r.id);
}
