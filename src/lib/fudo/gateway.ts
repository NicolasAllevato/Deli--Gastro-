import { createHmac, timingSafeEqual } from "node:crypto";
import { demoFudoPaymentMethodsPayload, demoFudoProductsPayload } from "@/lib/demo/fudo-fixture";
import { isDemoMode } from "@/lib/demo/mode";
import { runDemoCatalogSync } from "@/lib/fudo/demo-sync";
import { parseFudoCatalog, type FudoCatalogItem } from "@/lib/fudo/mapping";
import { createAdminClient } from "@/utils/supabase/admin";

/**
 * Enlace con el Worker `fudo-gateway` (workers/fudo-gateway), que es quien habla con la API de Fudo.
 * La app y el Worker se firman los pedidos con HMAC-SHA256 del cuerpo crudo (header `x-gateway-signature`,
 * hex) usando `FUDO_GATEWAY_SECRET`. Sin `FUDO_GATEWAY_URL` la integración está apagada.
 */
export interface FudoGatewayConfig {
  url: string;
  secret: string;
}

export const GATEWAY_SIGNATURE_HEADER = "x-gateway-signature";

export function fudoGatewayConfig(env: NodeJS.ProcessEnv = process.env): FudoGatewayConfig | null {
  const url = env.FUDO_GATEWAY_URL?.trim();
  const secret = env.FUDO_GATEWAY_SECRET?.trim();
  return url && secret ? { url: url.replace(/\/+$/, ""), secret } : null;
}

export function signGatewayBody(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

export function verifyGatewaySignature(body: string, signature: string | null, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(signGatewayBody(body, secret), "hex");
  return timingSafeEqual(expected, Buffer.from(signature, "hex"));
}

/**
 * Pide al Worker que mande el pedido a Fudo. Nunca tira: si falla, el pedido queda `pending`
 * y el cron del Worker lo reintenta.
 */
export async function requestFudoSync(orderId: string, config = fudoGatewayConfig()): Promise<boolean> {
  if (!config) return false;
  const body = JSON.stringify({ orderId });
  try {
    const res = await fetch(`${config.url}/sync`, {
      method: "POST",
      headers: { "content-type": "application/json", [GATEWAY_SIGNATURE_HEADER]: signGatewayBody(body, config.secret) },
      body,
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

const CATALOG_MAX_BYTES = 1_000_000;

/**
 * Lista de Fudo vía el Worker (la app firma el path) para la pantalla de mapeo.
 * Nunca tira: devuelve [] si la integración está apagada o el Worker no responde.
 */
async function fetchGatewayList(path: "/products" | "/payment-methods", config: FudoGatewayConfig | null): Promise<FudoCatalogItem[]> {
  if (!config) return [];
  try {
    const res = await fetch(`${config.url}${path}`, {
      headers: { [GATEWAY_SIGNATURE_HEADER]: signGatewayBody(path, config.secret) },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn(`[fudo] el Worker respondió ${res.status} al pedir ${path}`);
      return [];
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    const text = declared > CATALOG_MAX_BYTES ? "" : await res.text();
    if (declared > CATALOG_MAX_BYTES || new TextEncoder().encode(text).byteLength > CATALOG_MAX_BYTES) {
      console.warn("[fudo] el catálogo supera el tamaño máximo permitido");
      return [];
    }
    return parseFudoCatalog(JSON.parse(text));
  } catch {
    console.warn("[fudo] no se pudo leer el catálogo del Worker");
    return [];
  }
}

/** Catálogo de productos de Fudo. */
export async function fetchFudoCatalog(config = fudoGatewayConfig()): Promise<FudoCatalogItem[]> {
  if (isDemoMode()) return parseFudoCatalog(demoFudoProductsPayload());
  return fetchGatewayList("/products", config);
}

/** Medios de pago de Fudo (id, nombre y si están activos). */
export async function fetchFudoPaymentMethods(config = fudoGatewayConfig()): Promise<FudoCatalogItem[]> {
  if (isDemoMode()) return parseFudoCatalog(demoFudoPaymentMethodsPayload());
  return fetchGatewayList("/payment-methods", config);
}

export interface CatalogSyncSummary {
  categoriesCreated: number;
  categoriesUpdated: number;
  productsCreated: number;
  productsUpdated: number;
  productsDeactivated: number;
  /** Desactivaciones frenadas por el guardarraíl (listado de Fudo sospechosamente corto). */
  deactivationBlocked?: number;
  /** true = simulacro: no se escribió nada. */
  dryRun?: boolean;
}

export type CatalogSyncOutcome = { ok: true; summary: CatalogSyncSummary } | { ok: false; error: string };

/** Pide al Worker que sincronice el catálogo de Fudo ahora (el cron lo hace cada 15 min). Nunca tira. */
export async function requestCatalogSync(config = fudoGatewayConfig()): Promise<CatalogSyncOutcome> {
  if (isDemoMode()) {
    try {
      return { ok: true, summary: await runDemoCatalogSync(createAdminClient(), false) };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : "No se pudo sincronizar el catálogo simulado." };
    }
  }
  if (!config) return { ok: false, error: "La integración con Fudo no está configurada." };
  try {
    const res = await fetch(`${config.url}/catalog-sync`, {
      method: "POST",
      headers: { [GATEWAY_SIGNATURE_HEADER]: signGatewayBody("/catalog-sync", config.secret) },
      cache: "no-store",
      signal: AbortSignal.timeout(25_000),
    });
    const json = (await res.json().catch(() => ({}))) as { result?: CatalogSyncSummary; error?: string };
    if (!res.ok || !json.result) return { ok: false, error: json.error ?? `El gateway respondió ${res.status}.` };
    return { ok: true, summary: json.result };
  } catch {
    return { ok: false, error: "No se pudo contactar al gateway de Fudo." };
  }
}
