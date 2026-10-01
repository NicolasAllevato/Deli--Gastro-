import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, requireAnyRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { courierDisplayName } from "@/lib/auth/courier";
import { canTransition } from "@/lib/orders";
import { awardPointsForOrder, listOrders } from "@/lib/orders-server";
import type { OrderStatus } from "@/types/database";

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
  })
  .refine((v) => v.status !== undefined || v.courier_name !== undefined, {
    message: "Indicá status o courier_name",
  });

function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 200, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireAnyRole(["admin", "repartidor"]);
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

  const auth = await requireRole("admin");
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

  const auth = await requireAnyRole(["admin", "repartidor"]);
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

  if (auth.role === "repartidor") {
    const onTheWay = current.status === "En Camino";
    const mine = current.courier_name === null || current.courier_name === courierName;
    const takes = body.status === undefined && body.courier_name === courierName;
    const delivers = body.status === "Finalizados" && body.courier_name === undefined;
    if (!onTheWay || !mine || !(takes || delivers)) {
      return NextResponse.json({ error: "Acceso denegado." }, { status: 403 });
    }
  } else if (body.status !== undefined && !canTransition(current.status, body.status)) {
    return NextResponse.json(
      { error: `Transición inválida: ${current.status} → ${body.status}` },
      { status: 409 },
    );
  }

  const patch: { status?: OrderStatus; courier_name?: string | null } = {};
  if (body.status !== undefined) patch.status = body.status;
  if (body.courier_name !== undefined) patch.courier_name = body.courier_name;
  // Si entrega un repartidor que no se había asignado, queda registrado.
  if (auth.role === "repartidor" && body.status === "Finalizados" && current.courier_name === null) {
    patch.courier_name = courierName;
  }

  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (patch.status === "Finalizados") {
    await awardPointsForOrder(supabase, {
      id: data.id,
      client_id: data.client_id,
      total: Number(data.total),
      items_desc: data.items_desc,
    });
  }

  return NextResponse.json(data);
}
