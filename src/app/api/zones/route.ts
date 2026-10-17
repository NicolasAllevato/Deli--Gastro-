import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { readConfig } from "@/lib/orders-server";
import { listZones, localFromConfig, zoneInputSchema } from "@/lib/zones-server";

const patchSchema = zoneInputSchema.partial().extend({ id: z.string().uuid() }).strict();
const deleteSchema = z.object({ id: z.string().uuid() });

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Body inválido.";
}

async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireRole("admin");
  return isAuthorizationError(auth) ? auth.error : null;
}

export async function GET(req: NextRequest) {
  const denied = await guard(req, 60);
  if (denied) return denied;
  const db = createAdminClient();
  const [zones, config] = await Promise.all([listZones(db), readConfig(db)]);
  return NextResponse.json({ zones, local: localFromConfig(config) });
}

export async function POST(req: NextRequest) {
  const denied = await guard(req, 30);
  if (denied) return denied;

  const parsed = zoneInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("delivery_zones")
    .insert(parsed.data)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  const denied = await guard(req, 60);
  if (denied) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { id, ...changes } = parsed.data;
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });
  }

  const { data, error } = await createAdminClient()
    .from("delivery_zones")
    .update(changes)
    .eq("id", id)
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Zona no encontrada." }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const denied = await guard(req, 30);
  if (denied) return denied;

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { error } = await createAdminClient().from("delivery_zones").delete().eq("id", parsed.data.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
