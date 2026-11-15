/**
 * Reemplazo en código del trigger orders_link_fudo_client (migración 025 de Supabase), que D1 no tiene:
 * un pedido de Fudo sin cliente queda vinculado al cliente "anónimo" de su nombre + canal.
 */

export type RestFn = <T>(path: string, init?: RequestInit) => Promise<T>;

export interface AnonLinkable {
  client_id: string | null;
  customer_name: string | null;
  fudo_source: string | null;
  fudo_sale_type: string | null;
}

interface AnonClient {
  id: string;
  name: string;
  channel: string;
}

const SALE_TYPE_LABEL: Record<string, string> = { TAKEAWAY: "Take away", DELIVERY: "Delivery", "EAT-IN": "Salón" };

/** Igual que initcap de Postgres: mayúscula al inicio de cada palabra, el resto en minúscula. */
function initcap(text: string): string {
  return text.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/** Nombre del cliente anónimo: el de la venta o «Sin nombre · <tipo de venta>». */
export function anonClientName(name: string | null, saleType: string | null): string {
  const trimmed = name?.trim();
  const base = trimmed ? trimmed : `Sin nombre · ${SALE_TYPE_LABEL[saleType ?? ""] ?? "Fudo"}`;
  return initcap(base);
}

const keyOf = (name: string, channel: string): string => `${name.toLowerCase()}\u0000${channel}`;

/** Devuelve copias de las filas con client_id completado; crea los clientes anónimos que falten. */
export async function linkAnonymousClients<R extends AnonLinkable>(rest: RestFn, rows: readonly R[]): Promise<R[]> {
  const pending = rows.filter((r) => r.client_id === null);
  if (!pending.length) return [...rows];

  const wanted = new Map<string, { name: string; channel: string }>();
  for (const r of pending) {
    const name = anonClientName(r.customer_name, r.fudo_sale_type);
    const channel = r.fudo_source?.trim() || "local";
    wanted.set(keyOf(name, channel), { name, channel });
  }

  const known = new Map<string, string>();
  const index = (list: AnonClient[]): void => list.forEach((c) => known.set(keyOf(c.name, c.channel), c.id));
  index(await rest<AnonClient[]>("clients?is_anonymous=is.true&select=id,name,channel"));

  const missing = [...wanted].filter(([k]) => !known.has(k)).map(([, v]) => v);
  if (missing.length) {
    // Sin on_conflict: el índice único de D1 es sobre lower(name) y no se puede nombrar como columnas.
    let insertError: unknown = null;
    try {
      await rest("clients", {
        method: "POST",
        headers: { prefer: "return=minimal" },
        body: JSON.stringify(missing.map((m) => ({ name: m.name, source: "fudo", channel: m.channel, is_anonymous: true }))),
      });
    } catch (error: unknown) {
      // Otra corrida pudo crearlos al mismo tiempo: se relee y solo se falla si siguen faltando.
      insertError = error;
    }
    index(await rest<AnonClient[]>("clients?is_anonymous=is.true&select=id,name,channel"));
    if (insertError && missing.some((m) => !known.has(keyOf(m.name, m.channel)))) throw insertError;
  }

  return rows.map((r) => {
    if (r.client_id !== null) return r;
    const id = known.get(keyOf(anonClientName(r.customer_name, r.fudo_sale_type), r.fudo_source?.trim() || "local"));
    return id ? { ...r, client_id: id } : r;
  });
}
