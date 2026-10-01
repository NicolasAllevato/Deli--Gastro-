import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";

const categorySchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(80),
  description: z.string().trim().max(300).default(""),
  is_active: z.boolean().default(true),
});

const updateSchema = categorySchema.partial().extend({ id: z.string().uuid() });

function limited(req: NextRequest, max: number) {
  return rateLimit(getClientIp(req), max, 60_000);
}

function fail(error: z.ZodError) {
  return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
}

export async function POST(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = categorySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  const { data, error } = await createAdminClient().from("categories").insert(parsed.data).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!(await limited(req, 60))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  const { id, ...patch } = parsed.data;
  const { data, error } = await createAdminClient()
    .from("categories")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/** Borra la categoría y deja sus productos sin categoría (igual que `on delete set null`). */
export async function DELETE(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "id inválido." }, { status: 400 });

  const db = createAdminClient();
  await db.from("products").update({ category_id: null }).eq("category_id", id.data);
  const { error } = await db.from("categories").delete().eq("id", id.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
