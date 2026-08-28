import { z } from "zod";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** Secreto compartido para firmar el body (HMAC-SHA256, header `x-webhook-signature`). */
  WEBHOOK_SECRET: string;
}

async function verifySignature(body: string, signatureHeader: string | null, secret: string): Promise<boolean> {
  if (!signatureHeader) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );

  const signatureBytes = new Uint8Array(
    signatureHeader.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
  );

  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(body));
}

const ORDER_STATUSES = [
  "Recibidos",
  "En Preparación",
  "En Camino",
  "Finalizados",
  "Cancelado",
] as const;

const orderPayloadSchema = z.object({
  client_id: z.string().uuid().nullable().optional(),
  status: z.enum(ORDER_STATUSES).default("Recibidos"),
  items_desc: z.string().min(1),
  total: z.number().nonnegative(),
});

/**
 * Worker de baja latencia en el borde: recibe eventos de pedidos y hace
 * upsert directo contra Supabase vía su REST API (PostgREST), como capa
 * rápida en paralelo a n8n (no lo reemplaza).
 *
 * Deploy: `npx wrangler deploy` desde este directorio, después de:
 *   npx wrangler secret put SUPABASE_URL
 *   npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Método no permitido." }), {
        status: 405,
        headers: { "content-type": "application/json" },
      });
    }

    const rawBody = await request.text();

    const isValidSignature = await verifySignature(
      rawBody,
      request.headers.get("x-webhook-signature"),
      env.WEBHOOK_SECRET,
    );
    if (!isValidSignature) {
      return new Response(JSON.stringify({ error: "Firma inválida." }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }

    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return new Response(JSON.stringify({ error: "JSON inválido." }), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }

    const parsed = orderPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Payload inválido.", details: parsed.error.flatten() }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }

    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/orders`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(parsed.data),
    });

    if (!res.ok) {
      const errorText = await res.text();
      return new Response(
        JSON.stringify({ error: "Error al escribir el pedido en Supabase.", details: errorText }),
        { status: 502, headers: { "content-type": "application/json" } },
      );
    }

    const data = await res.json();
    return new Response(JSON.stringify({ success: true, data }), {
      status: 201,
      headers: { "content-type": "application/json" },
    });
  },
};
