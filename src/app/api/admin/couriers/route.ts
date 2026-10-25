import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { courierAuth } from "@/lib/courier-auth";
import { courierNameSchema, createCourier, listCouriers, pinSchema } from "@/lib/courier-pins";

// Alta de repartidores con PIN desde el admin. El PIN se devuelve una sola vez (se guarda su hash).

const createSchema = z.object({ name: courierNameSchema, pin: pinSchema.optional() });

export async function GET(req: NextRequest) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  try {
    return NextResponse.json(await listCouriers(createAdminClient()));
  } catch (error: unknown) {
    console.error("[admin/couriers] listar", error);
    return NextResponse.json({ error: "No se pudo leer la lista de repartidores." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 10);
  if (denied) return denied;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
  }
  try {
    const result = await createCourier(createAdminClient(), courierAuth(), parsed.data);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ courier: result.courier, pin: result.pin }, { status: 201 });
  } catch (error: unknown) {
    console.error("[admin/couriers] alta", error);
    return NextResponse.json({ error: "No se pudo crear el repartidor." }, { status: 500 });
  }
}
