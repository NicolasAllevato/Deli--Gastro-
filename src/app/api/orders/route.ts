import { NextRequest, NextResponse, after } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { canAssignCourier, isFudoDelivery, isFudoOrigin } from "@/lib/fudo/origin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, requireAnyRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { courierDisplayName } from "@/lib/auth/courier";
import { canTransition } from "@/lib/orders";
import { courierMayPatch, stagePatch, type StagePatch } from "@/lib/tracking";
import { notifyOrderEvent, type OrderNotice } from "@/lib/whatsapp/notify";
import { awardPointsForOrder, listOrders } from "@/lib/orders-server";
import { settleCancellation } from "@/lib/orders-create";
import type { OrderStatus } from "@/types/database";
import { locationSchema } from "@/lib/courier-location";
import { isCourierApproved } from "@/lib/courier-shifts";
import { courierToVerify } from "@/lib/courier-gate";

const VALID_STATUSES: OrderStatus[] = [
  "Recibidos", "En Preparación", "En Camino", "Finalizados", "Cancelado",
];

// Esta API es la del personal (admin y repartidor). Los pedidos que hace un
// cliente desde su portal viven en /api/client/orders, donde se valida la
// propiedad del pedido contra `clients.user_id` y los precios se recalculan
// en el servidor.

const createOrderSchema = z.object({
  items_desc: z.string().trim().min(1, "items_desc es requerido").max(2000),
  total: z.number().finite().nonnegative(),
  client_id: z.string().uuid().nullish(),
});

const updateOrderSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum(VALID_STATUSES as [OrderStatus, ...OrderStatus[]]).optional(),
    courier_name: z.string().trim().min(1).max(60).nullable().optional(),
    picked_up: z.literal(true).optional(),
    /** Posición del teléfono del repartidor al marcar entregado. */
    delivered_point: locationSchema.pick({ lat: true, lng: true, accuracy: true }).optional(),
  })
  .refine((v) => v.status !== undefined || v.courier_name !== undefined || v.picked_up === true, {
    message: "Indicá status, courier_name o picked_up",
  });

function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 200, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireAnyRole(["admin", "repartidor"], req);
  if (isAuthorizationError(auth)) return auth.error;

  const supabase = createAdminClient();
  // El repartidor sólo ve lo que tiene que entregar.
  const orders =
    auth.role === "repartidor"
      ? await listOrders(supabase, { statuses: ["En Camino"] })
      : await listOrders(supabase, { excludeCancelled: true });

  return NextResponse.json(orders);
}

export async function POST(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const parsed = createOrderSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .insert({
      items_desc: body.items_desc,
      total: body.total,
      client_id: body.client_id ?? null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireAnyRole(["admin", "repartidor"], req);
  if (isAuthorizationError(auth)) return auth.error;

  let rawBody: unknown;
  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json({ error: "Body inválido." }, { status: 400 });
  }

  const parsed = updateOrderSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createAdminClient();
  const { data: current, error: readError } = await supabase
    .from("orders")
    .select("*")
    .eq("id", body.id)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Pedido no encontrado." }, { status: 404 });

  const courierName = courierDisplayName(auth.user);
  // A quién hay que comprobar contra la habilitación del día (null: a nadie).
  const toVerify = courierToVerify({
    role: auth.role,
    ownName: courierName,
    requested: body.courier_name,
    current: current.courier_name,
  });

  if (auth.role === "repartidor") {
    if (!courierMayPatch(current, courierName, body)) {
      return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
    }
    // Tomar un pedido nuevo requiere que el local lo haya habilitado hoy; entregar lo que ya lleva, no.
    if (toVerify !== null && !(await isCourierApproved(supabase, toVerify))) {
      return NextResponse.json({ error: "El local todavía no te habilitó hoy." }, { status: 403 });
    }
  } else {
    if (body.status !== undefined && !canTransition(current.status, body.status)) {
      return NextResponse.json(
        { error: `Transición inválida: ${current.status} → ${body.status}` },
        { status: 409 },
      );
    }
    if ((body.courier_name !== undefined || body.picked_up) && !canAssignCourier(current)) {
      return NextResponse.json(
        { error: "Solo se asigna repartidor a pedidos en preparación o en camino." },
        { status: 409 },
      );
    }
    if (toVerify !== null && !(await isCourierApproved(supabase, toVerify))) {
      return NextResponse.json({ error: `${toVerify} no está habilitado hoy.` }, { status: 409 });
    }
  }
  if (body.picked_up && current.status !== "En Camino") {
    return NextResponse.json({ error: "El pedido todavía no está en camino." }, { status: 409 });
  }

  const patch: {
    status?: OrderStatus;
    courier_name?: string | null;
    picked_up_at?: string;
    delivered_lat?: number;
    delivered_lng?: number;
    delivered_accuracy_m?: number | null;
    delivered_in_app?: boolean;
  } & StagePatch = {};
  if (body.picked_up && !current.picked_up_at) patch.picked_up_at = new Date().toISOString();
  if (body.status !== undefined) {
    patch.status = body.status;
    Object.assign(patch, stagePatch(body.status));
  }
  if (body.courier_name !== undefined) patch.courier_name = body.courier_name;
  // Un delivery de Fudo con repartidor entra a su circuito: desde «En Camino» lo ve en la app y marca la entrega.
  if (body.courier_name && body.status === undefined && isFudoDelivery(current) && current.status !== "En Camino") {
    patch.status = "En Camino";
    Object.assign(patch, stagePatch("En Camino"));
  }
  if (body.status === "Finalizados" && isFudoOrigin(current)) patch.delivered_in_app = true;
  // Solo el repartidor que entrega deja el punto: es su teléfono el que estaba en la puerta.
  if (auth.role === "repartidor" && body.status === "Finalizados" && body.delivered_point) {
    patch.delivered_lat = body.delivered_point.lat;
    patch.delivered_lng = body.delivered_point.lng;
    patch.delivered_accuracy_m = body.delivered_point.accuracy ?? null;
  }
  // Si entrega un repartidor que no se había asignado, queda registrado.
  if (auth.role === "repartidor" && body.status === "Finalizados" && current.courier_name === null) {
    patch.courier_name = courierName;
  }

  // Update condicional: solo aplica si el pedido sigue como lo leímos. Así un doble clic o dos
  // personas a la vez no entregan dos veces (puntos y avisos duplicados) ni toman el mismo pedido.
  let update = supabase.from("orders").update(patch).eq("id", body.id).eq("status", current.status);
  if (patch.courier_name !== undefined) {
    update = current.courier_name === null ? update.is("courier_name", null) : update.eq("courier_name", current.courier_name);
  }
  const { data, error } = await update.select().maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "El pedido cambió mientras lo editabas. Actualizá e intentá de nuevo." }, { status: 409 });

  // Bitácora: no debe tumbar el cambio de estado si falla.
  const events: Array<{ event: string; detail?: string }> = [];
  if (patch.status) events.push({ event: patch.status });
  if (patch.picked_up_at) events.push({ event: "picked_up" });
  if (patch.courier_name && patch.courier_name !== current.courier_name) {
    events.push({ event: "assigned", detail: patch.courier_name });
  }
  if (events.length > 0) {
    await supabase
      .from("order_events")
      .insert(events.map((e) => ({ order_id: data.id, actor: auth.role, ...e })));
  }

  // Un pedido nacido en Fudo ya lo gestiona el local allá: sin WhatsApp, puntos, reembolsos ni canjes.
  if (isFudoOrigin(data)) return NextResponse.json(data);

  const notice = patch.status && patch.status !== "Cancelado" && patch.status !== "Recibidos" ? patch.status : null;
  if (notice) after(() => notifyOrderEvent(supabase, data.id, notice as OrderNotice));

  // Un pedido cancelado devuelve los puntos canjeados y, si se pagó online, el pago (idempotente).
  if (patch.status === "Cancelado") await settleCancellation(supabase, data.id);

  if (patch.status === "Finalizados") {
    await awardPointsForOrder(supabase, {
      id: data.id,
      client_id: data.client_id,
      total: Number(data.total),
      items_desc: data.items_desc,
      points_earned: data.points_earned,
    });
  }

  return NextResponse.json(data);
}
