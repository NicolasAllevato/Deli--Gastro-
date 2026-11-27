/**
 * Cliente de la API del sitio web de la pizzería (`https://www.la-gambeta.com/api/v1`).
 *
 * - `fetch` inyectable (tests) y timeout con AbortSignal.
 * - La clave (`LA_GAMBETA_API_KEY`, secreto del servidor) solo viaja en el encabezado Authorization: ningún mensaje de
 *   error, log ni respuesta la incluye.
 * - `request` es genérico (GET/POST/PUT/DELETE) para que la Etapa 2 publique cambios sin tocar este archivo.
 */
import { z } from "zod";
import {
  catalogSchema, envelopeSchema, promotionsSchema, siteBusinessSchema,
  type SiteCategory, type SitePromotion,
} from "./schemas.ts";

export const GAMBETA_BASE_URL = "https://www.la-gambeta.com/api/v1";
const DEFAULT_TIMEOUT_MS = 10_000;

export type GambetaErrorCode = "sin_clave" | "red" | "timeout" | "http" | "formato" | "rechazado";

export class GambetaError extends Error {
  readonly code: GambetaErrorCode;
  readonly status?: number;
  constructor(code: GambetaErrorCode, message: string, status?: number) {
    super(message);
    this.name = "GambetaError";
    this.code = code;
    this.status = status;
  }
}

export interface GambetaClientOptions {
  apiKey: string | null | undefined;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Lee la clave como el resto de los secretos del servidor (process.env; en producción es un secreto del Worker). */
export function readGambetaApiKey(env: Readonly<Record<string, string | undefined>> = process.env): string | null {
  const key = env.LA_GAMBETA_API_KEY?.trim();
  return key ? key : null;
}

/** Saca la clave de cualquier texto antes de mostrarlo (defensa extra). */
function scrub(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join("[clave]") : text;
}

type Method = "GET" | "POST" | "PUT" | "DELETE";

export interface GambetaClient {
  hasKey: boolean;
  request<T extends z.ZodType>(method: Method, path: string, schema: T, body?: unknown): Promise<z.infer<T>>;
  getCatalog(): Promise<SiteCategory[]>;
  getPromotions(): Promise<SitePromotion[]>;
  getBusiness(): Promise<Record<string, unknown>>;
}

export function createGambetaClient(opts: GambetaClientOptions): GambetaClient {
  const apiKey = opts.apiKey?.trim() ?? "";
  const base = (opts.baseUrl ?? GAMBETA_BASE_URL).replace(/\/$/, "");
  const doFetch = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function request<T extends z.ZodType>(method: Method, path: string, schema: T, body?: unknown): Promise<z.infer<T>> {
    if (!apiKey) throw new GambetaError("sin_clave", "Falta la clave de la API del sitio web (LA_GAMBETA_API_KEY).");
    if (!path.startsWith("/")) throw new GambetaError("formato", "Ruta inválida para la API del sitio web.");
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
        redirect: "error",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new GambetaError(
        timedOut ? "timeout" : "red",
        timedOut ? "El sitio web tardó demasiado en responder." : "No se pudo conectar con el sitio web.",
      );
    }
    const json: unknown = await res.json().catch(() => null);
    const envelope = envelopeSchema(schema).safeParse(json);
    const failedBody = envelope.success && envelope.data.success === false ? envelope.data : null;
    if (!res.ok || failedBody) {
      const detail = failedBody?.error;
      const msg = detail ? `El sitio web rechazó el pedido: ${detail}` : `El sitio web respondió con error ${res.status}.`;
      throw new GambetaError(res.status === 401 || res.status === 403 ? "rechazado" : "http", scrub(msg, apiKey), res.status);
    }
    if (!envelope.success || envelope.data.success !== true) {
      throw new GambetaError("formato", "El sitio web respondió con un formato inesperado.");
    }
    return envelope.data.data as z.infer<T>;
  }

  return {
    hasKey: apiKey.length > 0,
    request,
    getCatalog: () => request("GET", "/catalog?all=1", catalogSchema),
    getPromotions: () => request("GET", "/promotions?all=1", promotionsSchema),
    getBusiness: () => request("GET", "/business", siteBusinessSchema),
  };
}
