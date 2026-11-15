import { createHmac } from "node:crypto";
import type { FudoWriteGateway, GatewayResult } from "@/lib/data";
import { fudoGatewayConfig, GATEWAY_SIGNATURE_HEADER, type FudoGatewayConfig } from "@/lib/fudo/gateway";

/**
 * Escrituras de ventas al Worker fudo-gateway (POST /sales, PATCH /sales/:id/state, POST /payments).
 * SOLO servidor: firma con FUDO_GATEWAY_SECRET `MÉTODO path\nts\ncuerpo` (ver workers/fudo-gateway/src/sales-write.ts).
 * Nunca tira: devuelve { ok:false } y la capa de datos deja el pedido pendiente.
 */
export const GATEWAY_TS_HEADER = "x-gateway-ts";

export function signWrite(method: string, path: string, ts: string, body: string, secret: string): string {
  return createHmac("sha256", secret).update(`${method.toUpperCase()} ${path}\n${ts}\n${body}`).digest("hex");
}

/** POST /sales escribe líneas en secuencia: 90 s para no cortar mientras el Worker sigue (venta huérfana). */
const timeoutFor = (path: string): number => (path === "/sales" ? 90_000 : 20_000);

export function fudoWriteGateway(config: FudoGatewayConfig | null = fudoGatewayConfig()): FudoWriteGateway {
  return async (method, path, payload): Promise<GatewayResult> => {
    if (!config) return { ok: false, status: 0, error: "La integración con Fudo no está configurada." };
    const body = JSON.stringify(payload);
    const ts = String(Date.now());
    try {
      const res = await fetch(`${config.url}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          [GATEWAY_SIGNATURE_HEADER]: signWrite(method, path, ts, body, config.secret),
          [GATEWAY_TS_HEADER]: ts,
        },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutFor(path)),
      });
      const json = (await res.json().catch(() => null)) as { data?: unknown; error?: unknown; details?: { code?: unknown } } | null;
      if (res.ok) return { ok: true, status: res.status, data: json?.data ?? null };
      const code = typeof json?.details?.code === "string" ? json.details.code : undefined;
      const error = typeof json?.error === "string" ? json.error : `El gateway respondió ${res.status}.`;
      return { ok: false, status: res.status, error, ...(code ? { code } : {}) };
    } catch {
      return { ok: false, status: 0, error: "No se pudo contactar al gateway de Fudo." };
    }
  };
}
