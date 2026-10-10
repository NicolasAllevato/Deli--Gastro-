import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";
import { minutesSince } from "@/lib/orders";
import { numberConfig, readConfig } from "@/lib/orders-server";
import { cancelOrderForClient } from "@/lib/orders-create";

const idSchema = z.string().uuid();
const patchSchema = z.object({ action: z.literal("cancel") });

type Ctx = { params: Promise<{ id: string }> };

/** Seguimiento de un pedido propio: estado actual, repartidor, ETA y si ya fue reseñado. */
export async function GET(req: NextRequest, { params }: Ctx) {
  if (!(await rateLimit(getClientIp(req), 200, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  const db = createAdminClient();
  const { data: order } = await db
    .from("orders")
    .select("*")
    .eq("id", id.data)
    .eq("client_id", auth.client.id)
    .maybeSingle();
  if (!order) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  const [config, reviewRes] = await Promise.all([
    readConfig(db),
    db.from("reviews").select("id").eq("order_id", order.id).limit(1),
  ]);

  const cancelWindow = numberConfig(config, "cancelacion_min", 15);
  const canCancel = order.status === "Recibidos" && minutesSince(order.created_at) <= cancelWindow;

  return NextResponse.json({
    order,
    etaMinutes: numberConfig(config, "tiempo_entrega_min", 30),
    canCancel,
    cancelWindow,
    reviewed: (reviewRes.data ?? []).length > 0,
  });
}

/** El cliente sólo puede cancelar mientras el pedido siga "Recibidos" y dentro de la ventana configurada. */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  if (!(await rateLimit(getClientIp(req), 20, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireClient();
  if (isAuthorizationError(auth)) return auth.error;

  const id = idSchema.safeParse((await params).id);
  if (!id.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });

  if (!patchSchema.safeParse(await req.json().catch(() => null)).success) {
    return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  }

  const result = await cancelOrderForClient(createAdminClient(), id.data, auth.client.id, "cliente");
  if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
  return NextResponse.json(result.value);
}
