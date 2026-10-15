import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { PAYMENT_METHODS } from "@/lib/orders";
import { createDeliveryOrder } from "@/lib/orders-create";
import { notifyOrderEvent } from "@/lib/whatsapp/notify";

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

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const { data, error } = await createAdminClient()
    .from("orders")
    .select("*")
    .eq("client_id", auth.client.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * Checkout. El cliente sólo manda ids y cantidades: precios, subtotal y
 * costo de envío se recalculan en el servidor (ver `createDeliveryOrder`).
 */
export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }
  const { items, address, paymentMethod, notes, rewardId } = parsed.data;

  const db = createAdminClient();
  const result = await createDeliveryOrder(db, {
    clientId: auth.client.id,
    items,
    address,
    paymentMethod,
    notes,
    rewardId,
    channel: "web",
    actor: "cliente",
  });
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });

  after(() => notifyOrderEvent(db, result.value.id, "created"));
  return NextResponse.json(result.value, { status: 201 });
}
