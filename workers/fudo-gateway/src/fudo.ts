import type { FudoOrderBody } from "./payload";

export interface FudoEnv {
  FUDO_API_URL: string;
  FUDO_CLIENT_ID: string;
  FUDO_CLIENT_SECRET: string;
  FUDO_INTEGRATOR_TOKEN: string;
  FUDO_KV: KVNamespace;
}

const TOKEN_KEY = "fudo:token";
// Fudo da 24 h; se renueva a las 23 h para no usar nunca un token a punto de vencer.
const TOKEN_TTL_SECONDS = 23 * 60 * 60;

export class FudoError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 4xx de validación: reintentar no sirve, hay que corregir el pedido o el mapeo. */
    readonly permanent: boolean,
  ) {
    super(message);
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

export async function listFudoProducts(env: FudoEnv): Promise<unknown> {
  const res = await call(env, "/products");
  if (!res.ok) throw new FudoError(`Fudo /products ${res.status}`, res.status, false);
  return res.json();
}

export async function listFudoCategories(env: FudoEnv): Promise<unknown> {
  const res = await call(env, "/product-categories");
  if (!res.ok) throw new FudoError(`Fudo /product-categories ${res.status}`, res.status, false);
  return res.json();
}
