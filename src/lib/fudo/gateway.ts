import { createHmac, timingSafeEqual } from "node:crypto";
import { parseFudoCatalog, type FudoCatalogItem } from "@/lib/fudo/mapping";

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
 * Catálogo de productos de Fudo vía el Worker (la app firma el path). Sirve para sugerir ids en la
 * pantalla de mapeo; nunca tira: devuelve [] si la integración está apagada o el Worker no responde.
 */
export async function fetchFudoCatalog(config = fudoGatewayConfig()): Promise<FudoCatalogItem[]> {
  if (!config) return [];
  try {
    const res = await fetch(`${config.url}/products`, {
      headers: { [GATEWAY_SIGNATURE_HEADER]: signGatewayBody("/products", config.secret) },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) {
      console.warn(`[fudo] el Worker respondió ${res.status} al pedir el catálogo`);
      return [];
    }
    const declared = Number(res.headers.get("content-length") ?? 0);
    const text = declared > CATALOG_MAX_BYTES ? "" : await res.text();
    if (declared > CATALOG_MAX_BYTES || text.length > CATALOG_MAX_BYTES) {
      console.warn("[fudo] el catálogo supera el tamaño máximo permitido");
      return [];
    }
    return parseFudoCatalog(JSON.parse(text));
  } catch {
    console.warn("[fudo] no se pudo leer el catálogo del Worker");
    return [];
  }
}
