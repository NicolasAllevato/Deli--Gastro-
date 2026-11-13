import { requireStaff, type Actor } from "./actor.ts";
import type { SqlDatabase } from "./sql.ts";

/**
 * G16/G17: equivalentes en el servidor de `fudo_anonymous_client` (SECURITY
 * DEFINER, revocada para anon/authenticated) y del trigger
 * `orders_link_fudo_client` (migración 025). Solo staff/sistema.
 */
const CHANNELS = ["app", "local", "pedidosya", "rappi", "morfy"] as const;
type Channel = (typeof CHANNELS)[number];

const SALE_LABEL: Record<string, string> = { TAKEAWAY: "Take away", DELIVERY: "Delivery", "EAT-IN": "Salón" };

/** Igual que la función SQL: sin nombre se agrupa por tipo de venta. */
export function anonymousClientName(name: string | null | undefined, saleType?: string | null): string {
  const trimmed = (name ?? "").trim();
  const raw = trimmed || `Sin nombre · ${SALE_LABEL[saleType ?? ""] ?? "Fudo"}`;
  return initcap(raw);
}

/** initcap de Postgres: primera letra de cada palabra en mayúscula, el resto en minúscula. */
export function initcap(s: string): string {
  return s.toLocaleLowerCase("es-AR").replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase("es-AR"));
}

function normalizeChannel(channel: string | null | undefined): Channel {
  return (CHANNELS as readonly string[]).includes(channel ?? "") ? (channel as Channel) : "local";
}

/** Devuelve (y crea si hace falta) el cliente anónimo de un nombre en un canal. Idempotente y seguro ante carreras. */
export async function resolveAnonymousClient(
  db: SqlDatabase,
  actor: Actor,
  input: { name?: string | null; channel?: string | null; saleType?: string | null; newId: string },
): Promise<string> {
  requireStaff(actor);
  const name = anonymousClientName(input.name, input.saleType);
  const channel = normalizeChannel(input.channel);
  const find = () =>
    db
      .prepare("SELECT id FROM clients WHERE is_anonymous = 1 AND lower(name) = lower(?) AND channel = ?")
      .bind(name, channel)
      .first<{ id: string }>();
  const existing = await find();
  if (existing) return existing.id;
  // INSERT OR IGNORE: si otro proceso lo creó en el medio, el índice único parcial lo frena.
  await db
    .prepare("INSERT OR IGNORE INTO clients (id, name, source, channel, is_anonymous) VALUES (?, ?, 'fudo', ?, 1)")
    .bind(input.newId, name, channel)
    .run();
  const created = await find();
  if (!created) throw new Error("No se pudo resolver el cliente anónimo");
  return created.id;
}

/** Equivalente del trigger: un pedido de Fudo sin cliente se vincula al anónimo de su canal. */
export async function linkFudoOrderClient(
  db: SqlDatabase,
  actor: Actor,
  order: { channel: string; client_id: string | null; customer_name?: string | null; fudo_source?: string | null; fudo_sale_type?: string | null },
  newId: string,
): Promise<string | null> {
  requireStaff(actor);
  if (order.channel !== "fudo" || order.client_id) return order.client_id;
  return resolveAnonymousClient(db, actor, { name: order.customer_name, channel: order.fudo_source, saleType: order.fudo_sale_type, newId });
}
