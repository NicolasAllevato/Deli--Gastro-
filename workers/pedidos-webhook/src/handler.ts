import { z } from "zod";
import { executeD1Plan } from "../../../src/lib/data/plan-sql.ts";
import type { SqlDatabase } from "../../../src/lib/data/sql.ts";

export interface Env {
  /** "d1" → escribe solo en el binding DB. Otro valor → Supabase (legado). */
  DATA_BACKEND?: string;
  DB?: SqlDatabase;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** Secreto compartido para firmar el body (HMAC-SHA256, header `x-webhook-signature`). */
  WEBHOOK_SECRET?: string;
}

const SYSTEM = { kind: "system", reason: "pedidos-webhook" } as const;
const ORDER_STATUSES = ["Recibidos", "En Preparación", "En Camino", "Finalizados", "Cancelado"] as const;

const orderPayloadSchema = z.object({
  client_id: z.string().uuid().nullable().optional(),
  status: z.enum(ORDER_STATUSES).default("Recibidos"),
  items_desc: z.string().min(1),
  total: z.number().nonnegative(),
});
type OrderPayload = z.infer<typeof orderPayloadSchema>;

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function verifySignature(body: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  // Sin secreto configurado se rechaza todo (falla cerrado).
  if (!signatureHeader || !secret || !/^[0-9a-f]{64}$/i.test(signatureHeader)) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = new Uint8Array(signatureHeader.match(/.{2}/g)!.map((b) => parseInt(b, 16)));
  return crypto.subtle.verify("HMAC", key, bytes, new TextEncoder().encode(body));
}

async function writeD1(db: SqlDatabase, order: OrderPayload): Promise<{ data: unknown } | { error: string }> {
  const result = await executeD1Plan(db, SYSTEM, {
    table: "orders",
    action: "insert",
    columns: "*",
    filters: [],
    order: [],
    limit: null,
    payload: order,
    onConflict: "",
    returning: true,
    count: false,
    head: false,
    single: "none",
  });
  return result.error ? { error: `${result.error.code}` } : { data: result.data };
}

async function writeSupabase(env: Env, order: OrderPayload): Promise<{ data: unknown } | { error: string }> {
  const url = (env.SUPABASE_URL ?? "").trim();
  const key = (env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  if (!url || !key) return { error: "sin configuración" };
  const res = await fetch(`${url}/rest/v1/orders`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: key,
      authorization: `Bearer ${key}`,
      prefer: "resolution=merge-duplicates,return=representation",
    },
    body: JSON.stringify(order),
  });
  return res.ok ? { data: await res.json() } : { error: (await res.text()).slice(0, 200) };
}

/** Recibe eventos de pedidos firmados y los guarda (D1 o Supabase según DATA_BACKEND). */
export async function handleOrderWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return json({ error: "Método no permitido." }, 405);

  const rawBody = await request.text();
  if (!(await verifySignature(rawBody, request.headers.get("x-webhook-signature"), env.WEBHOOK_SECRET ?? ""))) {
    return json({ error: "Firma inválida." }, 401);
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }
  const parsed = orderPayloadSchema.safeParse(body);
  if (!parsed.success) return json({ error: "Payload inválido.", details: parsed.error.flatten() }, 400);

  const d1 = env.DATA_BACKEND?.trim().toLowerCase() === "d1";
  if (d1 && !env.DB) return json({ error: "Configuración incompleta." }, 500);
  const out = d1 ? await writeD1(env.DB!, parsed.data) : await writeSupabase(env, parsed.data);
  if ("error" in out) {
    console.error("[pedidos-webhook] escritura", out.error);
    return json({ error: "Error al guardar el pedido." }, 502);
  }
  return json({ success: true, data: out.data }, 201);
}
