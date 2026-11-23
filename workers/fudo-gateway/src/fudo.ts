import type { FudoOrderBody } from "./payload";

export interface FudoEnv {
  /** API de integraciones (pedidos): pide FUDO_CLIENT_ID/SECRET y el integrator token. */
  FUDO_API_URL: string;
  /** API pública de Fudo (catálogo, ventas): autentica con apiKey/apiSecret en FUDO_AUTH_URL. */
  FUDO_AUTH_URL: string;
  FUDO_PUBLIC_API_URL: string;
  FUDO_API_KEY: string;
  FUDO_API_SECRET: string;
  FUDO_CLIENT_ID: string;
  FUDO_CLIENT_SECRET: string;
  FUDO_INTEGRATOR_TOKEN: string;
  FUDO_KV: KvStore;
}

/**
 * Lo que usamos del binding KV. Estructural (el KVNamespace de Cloudflare lo cumple) para que el
 * typecheck de la app, que importa este módulo desde los tests, no necesite los tipos de Workers.
 */
export interface KvStore {
  get(key: string): Promise<string | null>;
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

const TOKEN_KEY = "fudo:token";
// Fudo da 24 h; se renueva a las 23 h para no usar nunca un token a punto de vencer.
const TOKEN_TTL_SECONDS = 23 * 60 * 60;

export class FudoError extends Error {
  readonly status: number;
  /** 4xx de validación: reintentar no sirve, hay que corregir el pedido o el mapeo. */
  readonly permanent: boolean;
  // Sin parameter properties: así los tests (node --test, strip-only) pueden importar este módulo.
  constructor(message: string, status: number, permanent: boolean) {
    super(message);
    this.status = status;
    this.permanent = permanent;
  }
}

async function fetchToken(env: FudoEnv): Promise<string> {
  const res = await fetch(`${env.FUDO_API_URL}/auth`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: env.FUDO_CLIENT_ID, clientSecret: env.FUDO_CLIENT_SECRET }),
  });
  if (!res.ok) throw new FudoError(`Fudo /auth respondió ${res.status}`, res.status, false);
  const json = (await res.json()) as { token?: unknown };
  if (typeof json.token !== "string" || !json.token) throw new FudoError("Fudo /auth no devolvió token", 502, false);
  await env.FUDO_KV.put(TOKEN_KEY, json.token, { expirationTtl: TOKEN_TTL_SECONDS });
  return json.token;
}

async function getToken(env: FudoEnv, fresh = false): Promise<string> {
  if (!fresh) {
    const cached = await env.FUDO_KV.get(TOKEN_KEY);
    if (cached) return cached;
  }
  return fetchToken(env);
}

/** Llamada autenticada. Si Fudo responde 401 con el token cacheado, se pide uno nuevo y se reintenta una vez. */
async function call(env: FudoEnv, path: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string) =>
    fetch(`${env.FUDO_API_URL}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "Fudo-External-App-Authorization": `Bearer ${token}`,
        "Fudo-Integrator-Token": env.FUDO_INTEGRATOR_TOKEN,
        ...init.headers,
      },
    });
  const res = await send(await getToken(env));
  return res.status === 401 ? send(await getToken(env, true)) : res;
}

export async function createFudoOrder(env: FudoEnv, body: FudoOrderBody): Promise<number> {
  const res = await call(env, "/orders", { method: "POST", body: JSON.stringify(body) });
  const text = await res.text();
  if (res.status !== 201 && res.status !== 200) {
    const permanent = res.status === 400 || res.status === 422;
    throw new FudoError(`Fudo /orders ${res.status}: ${text.slice(0, 300)}`, res.status, permanent);
  }
  const id = (JSON.parse(text) as { order?: { id?: unknown } }).order?.id;
  if (typeof id !== "number") throw new FudoError("Fudo /orders no devolvió order.id", 502, false);
  return id;
}

const PUBLIC_TOKEN_KEY = "fudo:public-token";
const PUBLIC_TOKEN_MAX_TTL_SECONDS = 23 * 60 * 60;
const PUBLIC_TOKEN_MARGIN_SECONDS = 5 * 60;
const PAGE_SIZE = 100;
/** Tope de páginas por listado: si se alcanza sin una página corta, el listado se considera incompleto y se rechaza. */
const MAX_PAGES = 60;

async function fetchPublicToken(env: FudoEnv): Promise<string> {
  const res = await fetch(env.FUDO_AUTH_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ apiKey: env.FUDO_API_KEY.trim(), apiSecret: env.FUDO_API_SECRET.trim() }),
  });
  if (!res.ok) throw new FudoError(`Fudo auth respondió ${res.status}`, res.status, false);
  const json = (await res.json()) as { token?: unknown; exp?: unknown };
  if (typeof json.token !== "string" || !json.token) throw new FudoError("Fudo auth no devolvió token", 502, false);
  const secondsLeft = typeof json.exp === "number" ? json.exp - Math.floor(Date.now() / 1000) - PUBLIC_TOKEN_MARGIN_SECONDS : PUBLIC_TOKEN_MAX_TTL_SECONDS;
  // KV exige un TTL mínimo de 60 s.
  const ttl = Math.max(60, Math.min(PUBLIC_TOKEN_MAX_TTL_SECONDS, secondsLeft));
  await env.FUDO_KV.put(PUBLIC_TOKEN_KEY, json.token, { expirationTtl: ttl });
  return json.token;
}

async function getPublicToken(env: FudoEnv, fresh = false): Promise<string> {
  if (!fresh) {
    const cached = await env.FUDO_KV.get(PUBLIC_TOKEN_KEY);
    if (cached) return cached;
  }
  return fetchPublicToken(env);
}

/** GET autenticado a la API pública; ante 401 con el token cacheado pide uno nuevo y reintenta una vez. */
export async function publicGet(env: FudoEnv, path: string): Promise<Response> {
  const send = async (token: string) =>
    fetch(`${env.FUDO_PUBLIC_API_URL}/${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  const res = await send(await getPublicToken(env));
  return res.status === 401 ? send(await getPublicToken(env, true)) : res;
}

/**
 * POST/PATCH autenticado a la API pública. SIN reintentos (reintentar una escritura financiera puede
 * duplicar dinero): la única excepción es un 401, donde Fudo rechazó el token sin procesar nada.
 */
export async function publicWrite(env: FudoEnv, method: "POST" | "PATCH", path: string, body: unknown): Promise<Response> {
  const send = async (token: string) =>
    fetch(`${env.FUDO_PUBLIC_API_URL}/${path}`, {
      method,
      headers: { authorization: `Bearer ${token}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const res = await send(await getPublicToken(env));
  return res.status === 401 ? send(await getPublicToken(env, true)) : res;
}

/**
 * Trae TODAS las páginas de un recurso (JSON:API) y las devuelve juntas como `{ data: [...] }`.
 * `query` agrega filtros y orden con la sintaxis de Fudo, por ejemplo
 * `filter[createdAt]=and(gte.2026-11-01T00:00:00,lte.2026-11-03T23:59:59)&sort=-createdAt`.
 */
export async function listPublicResource(env: FudoEnv, resource: string, query = ""): Promise<{ data: unknown[]; included: unknown[] }> {
  const data: unknown[] = [];
  // Con `include=...` Fudo agrega las entidades relacionadas en `included` (por ejemplo los ítems de cada venta).
  const included: unknown[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const res = await publicGet(env, `${resource}?${query ? `${query}&` : ""}page[size]=${PAGE_SIZE}&page[number]=${page}`);
    if (!res.ok) throw new FudoError(`Fudo ${resource} ${res.status}`, res.status, false);
    const body = (await res.json()) as { data?: unknown; included?: unknown };
    if (!Array.isArray(body.data)) throw new FudoError(`Fudo ${resource} no devolvió una lista`, 502, false);
    data.push(...body.data);
    if (Array.isArray(body.included)) included.push(...body.included);
    if (body.data.length < PAGE_SIZE) return { data, included };
  }
  throw new FudoError(`Fudo ${resource}: más de ${MAX_PAGES * PAGE_SIZE} registros, listado incompleto`, 502, false);
}

export const listFudoProducts = (env: FudoEnv): Promise<unknown> => listPublicResource(env, "products");
export const listFudoCategories = (env: FudoEnv): Promise<unknown> => listPublicResource(env, "product-categories");
export const listFudoModifierGroups = (env: FudoEnv): Promise<unknown> => listPublicResource(env, "product-modifiers-groups");
export const listFudoModifiers = (env: FudoEnv): Promise<unknown> => listPublicResource(env, "product-modifiers");
export const listFudoPaymentMethods = (env: FudoEnv): Promise<unknown> => listPublicResource(env, "payment-methods");

