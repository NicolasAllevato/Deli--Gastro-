import { z } from "zod";
import { PAYMENT_METHODS } from "@/lib/orders";
import type { createAdminClient } from "@/utils/supabase/admin";

type Db = ReturnType<typeof createAdminClient>;

/**
 * Mapeo de la app con Fudo (migración 017): producto de la app -> id de producto de Fudo y
 * medio de pago de la app -> id de medio de pago de Fudo. El Worker `fudo-gateway` lee estas
 * tablas para armar el pedido; sin mapeo el pedido queda `skipped`. Ver docs/FUDO_INTEGRACION.md.
 */

export type MappedPaymentMethod = (typeof PAYMENT_METHODS)[number];

export const FUDO_NAME_MAX = 120;
export const CATALOG_MAX_ITEMS = 5000;
const REQUEUE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Texto con el que el Worker marca `fudo_error` cuando falta mapear productos (workers/fudo-gateway/src/payload.ts). */
export const UNMAPPED_ERROR_PREFIX = "Productos sin mapear a Fudo";

const fudoId = z
  .number()
  .int("El id de Fudo es un número entero.")
  .positive("El id de Fudo tiene que ser mayor a 0.")
  .max(2_147_483_647, "El id de Fudo es demasiado grande.");

export const saveSchema = z
  .object({
    products: z
      .array(z.object({
        productId: z.string().uuid("Producto inválido."),
        fudoProductId: fudoId,
        fudoName: z.string().trim().transform((v) => v.slice(0, FUDO_NAME_MAX)).nullish(),
      }))
      .max(500)
      .default([]),
    payments: z
      .array(z.object({ paymentMethod: z.enum(PAYMENT_METHODS), fudoPaymentMethodId: fudoId }))
      .max(PAYMENT_METHODS.length)
      .default([]),
    removeProducts: z.array(z.string().uuid()).max(500).default([]),
    removePayments: z.array(z.enum(PAYMENT_METHODS)).max(PAYMENT_METHODS.length).default([]),
  })
  .refine((v) => !v.products.some((p) => v.removeProducts.includes(p.productId)), {
    message: "Un mismo producto no puede guardarse y quitarse a la vez.",
  })
  .refine((v) => v.products.length + v.payments.length + v.removeProducts.length + v.removePayments.length > 0, {
    message: "No hay cambios para guardar.",
  });
export type SaveInput = z.infer<typeof saveSchema>;

export interface ProductMapRow { product_id: string; fudo_product_id: number; fudo_name: string | null }
export interface PaymentMapRow { payment_method: string; fudo_payment_method_id: number }

export interface MappedProduct {
  id: string;
  name: string;
  category: string | null;
  isActive: boolean;
  fudoProductId: number | null;
  fudoName: string | null;
}
export interface MappedPayment { method: MappedPaymentMethod; fudoPaymentMethodId: number | null }
export interface FudoCatalogItem { id: number; name: string; active: boolean }

export interface MappingState {
  products: MappedProduct[];
  payments: MappedPayment[];
  /** Productos activos de la app sin id de Fudo: sus pedidos quedan `skipped`. */
  unmappedProducts: number;
  unmappedPayments: number;
}

/** Filas para guardar (upsert). Si el mismo producto viene dos veces, gana la última. */
export function buildProductRows(items: SaveInput["products"]): ProductMapRow[] {
  const byId = new Map<string, ProductMapRow>();
  for (const i of items) {
    byId.set(i.productId, { product_id: i.productId, fudo_product_id: i.fudoProductId, fudo_name: i.fudoName?.trim() || null });
  }
  return [...byId.values()];
}

export function buildPaymentRows(items: SaveInput["payments"]): PaymentMapRow[] {
  const byMethod = new Map<string, PaymentMapRow>();
  for (const i of items) {
    byMethod.set(i.paymentMethod, { payment_method: i.paymentMethod, fudo_payment_method_id: i.fudoPaymentMethodId });
  }
  return [...byMethod.values()];
}

/** Productos activos que todavía no tienen id de Fudo. */
export function findUnmappedProducts<T extends { isActive: boolean; fudoProductId: number | null }>(products: T[]): T[] {
  return products.filter((p) => p.isActive && p.fudoProductId === null);
}

export function findUnmappedPayments(payments: MappedPayment[]): MappedPayment[] {
  return payments.filter((p) => p.fudoPaymentMethodId === null);
}

export interface ProductRow {
  id: string;
  name: string;
  is_active: boolean;
  categories: { name: string } | { name: string }[] | null;
}

export function buildMappingState(products: ProductRow[], productMap: ProductMapRow[], paymentMap: PaymentMapRow[]): MappingState {
  const mapByProduct = new Map(productMap.map((m) => [m.product_id, m]));
  const mapByMethod = new Map(paymentMap.map((m) => [m.payment_method, m.fudo_payment_method_id]));
  const mappedProducts: MappedProduct[] = products.map((p) => {
    const cat = Array.isArray(p.categories) ? p.categories[0] : p.categories;
    const m = mapByProduct.get(p.id);
    return {
      id: p.id, name: p.name, category: cat?.name ?? null, isActive: p.is_active,
      fudoProductId: m?.fudo_product_id ?? null, fudoName: m?.fudo_name ?? null,
    };
  });
  const payments: MappedPayment[] = PAYMENT_METHODS.map((method) => ({
    method, fudoPaymentMethodId: mapByMethod.get(method) ?? null,
  }));
  return {
    products: mappedProducts,
    payments,
    unmappedProducts: findUnmappedProducts(mappedProducts).length,
    unmappedPayments: findUnmappedPayments(payments).length,
  };
}

/**
 * Lee el catálogo de Fudo. La spec real (GET /products) responde `{ products: [{ id, name, active, ... }] }`;
 * también se acepta una lista plana o JSON:API (`data[].attributes.name`). Devuelve el catálogo COMPLETO
 * (con `active`) para validar ids; para sugerencias usar `suggestionsFrom`.
 */
export function parseFudoCatalog(raw: unknown): FudoCatalogItem[] {
  const root = raw as { products?: unknown; data?: unknown } | null;
  const list = Array.isArray(raw) ? raw : (root?.products ?? root?.data);
  if (!Array.isArray(list)) return [];
  const items: FudoCatalogItem[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { id?: unknown; name?: unknown; active?: unknown; attributes?: { name?: unknown; active?: unknown } };
    const id = Number(e.id);
    const name = typeof e.attributes?.name === "string" ? e.attributes.name : e.name;
    if (Number.isInteger(id) && id > 0 && typeof name === "string" && name.trim()) {
      items.push({ id, name: name.trim().slice(0, FUDO_NAME_MAX), active: (e.attributes?.active ?? e.active) !== false });
    }
  }
  return items.sort((a, b) => a.name.localeCompare(b.name, "es"));
}

/** Sugerencias para el datalist: solo productos activos, hasta 5000. */
export function suggestionsFrom(catalog: FudoCatalogItem[]): FudoCatalogItem[] {
  return catalog.filter((c) => c.active).slice(0, CATALOG_MAX_ITEMS);
}

export type SaveDecision =
  | { ok: true; products: SaveInput["products"] }
  | { ok: false; error: string };

/** Decide si se puede guardar: con catálogo no vacío rechaza ids desconocidos; sin catálogo deja pasar (fail-open). */
export function decideSave(products: SaveInput["products"], catalog: FudoCatalogItem[]): SaveDecision {
  const unknown = findUnknownFudoIds(products, catalog);
  if (unknown.length > 0) {
    return {
      ok: false,
      error: `Ese id no figura en el catálogo de Fudo: ${unknown.join(", ")}. Revisalo para no enviar el plato equivocado.`,
    };
  }
  return { ok: true, products: applyCatalogNames(products, catalog) };
}

/** Ids de `products` que no figuran en un catálogo no vacío (sin catálogo no se puede decidir). */
export function findUnknownFudoIds(products: SaveInput["products"], catalog: FudoCatalogItem[]): number[] {
  if (catalog.length === 0) return [];
  const known = new Set(catalog.map((c) => c.id));
  return [...new Set(products.filter((p) => !known.has(p.fudoProductId)).map((p) => p.fudoProductId))];
}

/** El servidor no confía en el nombre del cliente: con catálogo usa el de Fudo; sin él, el del cliente truncado. */
export function applyCatalogNames(products: SaveInput["products"], catalog: FudoCatalogItem[]): SaveInput["products"] {
  const names = new Map(catalog.map((c) => [c.id, c.name]));
  return products.map((p) => ({ ...p, fudoName: names.get(p.fudoProductId) ?? p.fudoName ?? null }));
}

/** Límite de antigüedad de los pedidos omitidos que se reencolan (evita reenviar pedidos viejos). */
export function requeueCutoff(now: number = Date.now()): string {
  return new Date(now - REQUEUE_WINDOW_MS).toISOString();
}

interface Eq<Q> { eq(column: string, value: string): Q; is(column: string, value: null): Q }

/** Base de los omitidos: `skipped` y sin pedido creado en Fudo. */
function onlySkipped<Q extends Eq<Q>>(query: Q): Q {
  return query.eq("fudo_sync_status", "skipped").is("fudo_order_id", null);
}

/** Pedidos omitidos por falta de mapeo: el MISMO criterio para contarlos y para reencolarlos. */
function onlySkippedByMapping<Q extends Eq<Q> & { like(column: string, pattern: string): Q }>(query: Q): Q {
  return onlySkipped(query).like("fudo_error", `${UNMAPPED_ERROR_PREFIX}%`);
}

const SKIPPED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
/** El cron del gateway toma pedidos de más de 1 min (db.ts listRetryable); 10 min de margen para no avisar de lo normal. */
const STUCK_AFTER_MS = 10 * 60 * 1000;
/** Mismo tope de intentos que `MAX_ATTEMPTS` del Worker: con más, el pedido ya pasó a `skipped`. */
const GATEWAY_MAX_ATTEMPTS = 6;

export interface SkippedSummary {
  /** Omitidos por falta de mapeo (últimos 30 días): nunca se reintentan solos. */
  byMapping: { count: number; oldestAt: string | null; recentCount: number };
  /** Omitidos por otro motivo (rechazo de Fudo, sin líneas, intentos agotados), sin solaparse con byMapping. */
  otherSkipped: number;
  /** Pending/failed con más de 10 minutos de espera y todavía con intentos disponibles. */
  stuck: number;
}

export const EMPTY_SKIPPED: SkippedSummary = { byMapping: { count: 0, oldestAt: null, recentCount: 0 }, otherSkipped: 0, stuck: 0 };

/** Cuenta pedidos que no llegaron a Fudo (ventana de 30 días). Lanza ante error de base: el llamador decide degradar. */
export async function countSkippedOrders(db: Db, now: number = Date.now()): Promise<SkippedSummary> {
  const since = new Date(now - SKIPPED_WINDOW_MS).toISOString();
  const head = { count: "exact" as const, head: true };
  const [total, recent, oldest, other, stuck] = await Promise.all([
    onlySkippedByMapping(db.from("orders").select("id", head)).gte("created_at", since),
    onlySkippedByMapping(db.from("orders").select("id", head)).gte("created_at", requeueCutoff(now)),
    onlySkippedByMapping(db.from("orders").select("created_at")).gte("created_at", since).order("created_at", { ascending: true }).limit(1),
    onlySkipped(db.from("orders").select("id", head)).not("fudo_error", "like", `${UNMAPPED_ERROR_PREFIX}%`).gte("created_at", since),
    db.from("orders").select("id", head)
      .in("fudo_sync_status", ["pending", "failed"]).is("fudo_order_id", null)
      .lt("fudo_attempts", GATEWAY_MAX_ATTEMPTS)
      .gte("created_at", since).lt("created_at", new Date(now - STUCK_AFTER_MS).toISOString()),
  ]);
  const failed = total.error ?? recent.error ?? oldest.error ?? other.error ?? stuck.error;
  if (failed) throw new Error(failed.message);
  const first = (oldest.data as { created_at: string }[] | null)?.[0];
  return {
    byMapping: { count: total.count ?? 0, oldestAt: first?.created_at ?? null, recentCount: recent.count ?? 0 },
    otherSkipped: other.count ?? 0,
    stuck: stuck.count ?? 0,
  };
}

/** El aviso es accesorio: ante cualquier error se loguea (sin datos) y se devuelve el resumen vacío. */
export async function safeCountSkippedOrders(db: Db, now: number = Date.now()): Promise<SkippedSummary> {
  try {
    return await countSkippedOrders(db, now);
  } catch (error: unknown) {
    console.error("[admin/fudo-map] contar omitidos", error instanceof Error ? error.message : "error");
    return EMPTY_SKIPPED;
  }
}

/** Cuerpo del GET de /api/admin/fudo-map: el mapeo de siempre más `skipped` (campo nuevo). */
export function buildMapResponse(
  mapping: MappingState,
  catalog: FudoCatalogItem[],
  gatewayConfigured: boolean,
  skipped: SkippedSummary,
) {
  return { ...mapping, catalog: suggestionsFrom(catalog), gatewayConfigured, skipped };
}

export async function loadMapping(db: Db): Promise<MappingState> {
  const [products, productMap, paymentMap] = await Promise.all([
    db.from("products").select("id,name,is_active,categories(name)").order("name", { ascending: true }),
    db.from("fudo_product_map").select("product_id,fudo_product_id,fudo_name"),
    db.from("fudo_payment_map").select("payment_method,fudo_payment_method_id"),
  ]);
  const failed = products.error ?? productMap.error ?? paymentMap.error;
  if (failed) throw new Error(failed.message);
  return buildMappingState(
    (products.data ?? []) as unknown as ProductRow[],
    (productMap.data ?? []) as ProductMapRow[],
    (paymentMap.data ?? []) as PaymentMapRow[],
  );
}

/**
 * Guarda el mapeo y devuelve cuántos pedidos omitidos por falta de mapeo se reencolaron a `pending`
 * (una sola query; `fudo_attempts` vuelve a 0 porque el Worker descarta los que llegaron al máximo).
 */
export async function saveMapping(db: Db, input: SaveInput, now: number = Date.now()): Promise<number> {
  const productRows = buildProductRows(input.products);
  const paymentRows = buildPaymentRows(input.payments);
  const stamp = new Date(now).toISOString();
  const steps = [
    productRows.length ? db.from("fudo_product_map").upsert(productRows.map((r) => ({ ...r, updated_at: stamp })), { onConflict: "product_id" }) : null,
    paymentRows.length ? db.from("fudo_payment_map").upsert(paymentRows.map((r) => ({ ...r, updated_at: stamp })), { onConflict: "payment_method" }) : null,
    input.removeProducts.length ? db.from("fudo_product_map").delete().in("product_id", input.removeProducts) : null,
    input.removePayments.length ? db.from("fudo_payment_map").delete().in("payment_method", input.removePayments) : null,
  ];
  for (const step of steps) {
    if (!step) continue;
    const { error } = await step;
    if (error) throw new Error(error.message);
  }
  if (productRows.length === 0) return 0;
  const { data, error } = await onlySkippedByMapping(
    db.from("orders").update({ fudo_sync_status: "pending", fudo_error: null, fudo_attempts: 0 }),
  )
    .gte("created_at", requeueCutoff(now))
    .select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}
