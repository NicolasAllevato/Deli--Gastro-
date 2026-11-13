import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { PAYMENT_METHODS } from "@/lib/orders";
import { createDeliveryOrder } from "@/lib/orders-create";
import { notifyOrderEvent } from "@/lib/whatsapp/notify";
import { getGateway } from "@/lib/payments/gateway";
import { startOnlinePayment } from "@/lib/payments/intents";
import { clientOrders } from "@/lib/client-reads";

const createSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().uuid(), qty: z.number().int().min(1).max(20) }))
    .min(1, "El carrito está vacío")
    .max(30),
  address: z.object({
    address: z.string().trim().min(5, "Indicá la dirección de entrega").max(200),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(300).optional(),
  rewardId: z.string().min(1).max(40).optional(),
});

/** Pedidos del cliente autenticado (más recientes primero). */
export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 200, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  try {
    const data = await clientOrders({ db: createAdminClient(), userId: auth.user.id, clientId: auth.client.id });
    return NextResponse.json(data);
  } catch (err) {
    console.error("[client] pedidos", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
}

/**
 * Checkout. El cliente sólo manda ids y cantidades: precios, subtotal y
 * costo de envío se recalculan en el servidor (ver `createDeliveryOrder`).
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }
  const { items, address, paymentMethod, notes, rewardId } = parsed.data;

  const db = createAdminClient();
  const order = {
    clientId: auth.client.id,
    items,
    address,
    paymentMethod,
    notes,
    rewardId,
    channel: "web" as const,
    actor: "cliente",
  };

  // Con Mercado Pago el pedido todavía no existe: se abre el pago y el pedido se crea cuando se aprueba.
  if (paymentMethod === "Mercado Pago") {
    const gateway = getGateway();
    if (!gateway) {
      return NextResponse.json({ error: "El pago con Mercado Pago todavía no está habilitado." }, { status: 400 });
    }
    const started = await startOnlinePayment(db, gateway, order);
    if (!started.ok) return NextResponse.json({ error: started.message }, { status: started.status });
    return NextResponse.json(
      { paymentUrl: started.value.url, intentId: started.value.intentId, total: started.value.total },
      { status: 201 },
    );
  }

  const result = await createDeliveryOrder(db, order);
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });

  after(() => notifyOrderEvent(db, result.value.id, "created"));
  return NextResponse.json(result.value, { status: 201 });
}
