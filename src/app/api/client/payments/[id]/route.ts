import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { getGateway } from "@/lib/payments/gateway";
import { cancelPendingIntent, getIntentForClient, reconcileIntent } from "@/lib/payments/intents";
import { notifyOrderEvent } from "@/lib/whatsapp/notify";

const idSchema = z.string().uuid();

type Ctx = { params: Promise<{ id: string }> };

/**
 * Estado del pago de un pedido propio. Mientras está pendiente se concilia con Mercado Pago: si el
 * webhook todavía no llegó (o no puede llegar, como en desarrollo) igual se crea el pedido ya pagado.
 */
export async function GET(req: NextRequest, { params }: Ctx) {
  if (!(await rateLimit(getClientIp(req), 120, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Pago inválido." }, { status: 400 });

  const db = createAdminClient();
  let intent = await getIntentForClient(db, id.data, auth.client.id);
  if (!intent) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 });

  const gateway = getGateway();
  if (intent.status === "pending" && gateway && gateway.name === "mercadopago") {
    const settled = await reconcileIntent(db, gateway, intent.id);
    if (settled?.kind === "order_created") {
      const orderId = settled.order.id;
      after(() => notifyOrderEvent(db, orderId, "created"));
    }
    intent = (await getIntentForClient(db, id.data, auth.client.id)) ?? intent;
  }

  return NextResponse.json(intent);
}

/** El cliente abandona un pago que todavía no se aprobó. */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  if (!(await rateLimit(getClientIp(req), 20, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Pago inválido." }, { status: 400 });

  const cancelled = await cancelPendingIntent(createAdminClient(), id.data, auth.client.id);
  if (!cancelled) return NextResponse.json({ error: "Este pago ya no se puede cancelar." }, { status: 409 });
  return NextResponse.json({ ok: true });
}
