import { createAdminClient } from "@/utils/supabase/admin";
import type { PaymentGateway } from "./gateway.ts";
import { settlePayment } from "./intents.ts";
import { verifyWebhookSignature } from "./mercadopago.ts";

type Db = ReturnType<typeof createAdminClient>;

export const MAX_WEBHOOK_BODY_BYTES = 64 * 1024;

export interface WebhookRequest {
  rawBody: string;
  signatureHeader: string | null;
  requestId: string | null;
  /** `?data.id=` de la URL: es el id con el que Mercado Pago firma. */
  queryDataId: string | null;
  queryType: string | null;
  secret: string;
  nowSeconds?: number;
}

export interface WebhookResponse {
  status: 200 | 400 | 401 | 413 | 500;
  body?: Record<string, unknown>;
  /** Pedido recién creado: la ruta le avisa al cliente por WhatsApp. */
  createdOrderId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Procesa un aviso de Mercado Pago. Orden de las defensas: tamaño → cuerpo válido → firma y frescura →
 * tipo de aviso → el pago se vuelve a pedir a la API (el cuerpo del aviso no se usa para nada más que
 * para saber qué pago consultar) → se compara contra la intención cotizada → recién ahí se crea el pedido.
 */
export async function handleMercadoPagoWebhook(db: Db, gateway: PaymentGateway, req: WebhookRequest): Promise<WebhookResponse> {
  if (req.rawBody.length > MAX_WEBHOOK_BODY_BYTES) return { status: 413 };

  let parsed: { type?: unknown; data?: { id?: unknown } };
  try {
    parsed = JSON.parse(req.rawBody) as typeof parsed;
  } catch {
    return { status: 400 };
  }
  if (typeof parsed !== "object" || parsed === null) return { status: 400 };

  const bodyId = parsed.data?.id;
  const dataId = req.queryDataId ?? (typeof bodyId === "string" || typeof bodyId === "number" ? String(bodyId) : null);

  const signature = verifyWebhookSignature({
    signatureHeader: req.signatureHeader,
    requestId: req.requestId,
    dataId,
    secret: req.secret,
    nowSeconds: req.nowSeconds,
  });
  if (!signature.ok) return { status: 401, body: { reason: signature.reason } };

  const type = typeof parsed.type === "string" ? parsed.type : req.queryType;
  if (type !== "payment" || !dataId) return { status: 200, body: { received: true, ignored: true } };

  try {
    const payment = await gateway.fetchPayment(dataId);
    const reference = payment.external_reference;
    if (!reference || !UUID.test(reference)) return { status: 200, body: { received: true, ignored: true } };

    const settled = await settlePayment(db, gateway, reference, payment);
    if (!settled.ok) return { status: 500 }; // Mercado Pago reintenta
    return {
      status: 200,
      body: { received: true, result: settled.value.kind },
      createdOrderId: settled.value.kind === "order_created" ? settled.value.order.id : undefined,
    };
  } catch {
    return { status: 500 };
  }
}
