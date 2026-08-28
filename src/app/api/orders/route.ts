import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import type { OrderStatus } from "@/types/database";

const VALID_STATUSES: OrderStatus[] = [
  "Recibidos", "En Preparación", "En Camino", "Finalizados", "Cancelado",
];

// Nota: hoy /api/orders sólo es consumida por el portal admin (tablero de
// pedidos). Por eso las 3 operaciones exigen rol "admin". Si en el futuro
// se agrega checkout desde el portal cliente, esa creación de pedidos debe
// vivir en un endpoint separado (o una rama explícita aquí) que valide
// ownership contra `clients.user_id`, en vez de reusar este endpoint admin.

const createOrderSchema = z.object({
  items_desc: z.string().trim().min(1, "items_desc es requerido").max(2000),
  total: z.number().finite().nonnegative(),
  client_id: z.string().uuid().nullish(),
});

const updateOrderSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(VALID_STATUSES as [OrderStatus, ...OrderStatus[]]),
});

function zodErrorMessage(error: z.ZodError): string {
  return error.issues.map((issue) => issue.message).join("; ");
}

export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 200, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }

  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .select("id, client_id, status, items_desc, total, created_at")
    .neq("status", "Cancelado")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
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
  if (!(await rateLimit(getClientIp(req), 20, 60_000))) {
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

  const parsed = updateOrderSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
  }
  const body = parsed.data;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("orders")
    .update({ status: body.status })
    .eq("id", body.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
