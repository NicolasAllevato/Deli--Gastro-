import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { FUDO_MANAGED_CATEGORY_FIELDS, stripFudoManaged } from "@/lib/fudo/catalog-lock";

const categorySchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(80),
  description: z.string().trim().max(300).default(""),
  is_active: z.boolean().default(true),
  points_per_100: z.number().finite().min(0).max(1000).nullable().default(null),
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
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = categorySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  const { data, error } = await createAdminClient().from("categories").insert(parsed.data).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}

export async function PATCH(req: NextRequest) {
  if (!(await limited(req, 60))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  const { id, ...requested } = parsed.data;
  const db = createAdminClient();
  const current = await db.from("categories").select("fudo_id").eq("id", id).maybeSingle();
  if (current.error) return NextResponse.json({ error: current.error.message }, { status: 500 });
  if (!current.data) return NextResponse.json({ error: "Categoría no encontrada." }, { status: 404 });

  // El nombre de una categoría de Fudo lo manda Fudo: renombrarla acá sería pisado en la próxima sincronización.
  const { patch, ignored } = stripFudoManaged(requested, current.data.fudo_id ?? null, FUDO_MANAGED_CATEGORY_FIELDS);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json(
      { error: `Esta categoría se administra desde Fudo (${ignored.join(", ")}). Cambialo allá y se actualiza solo.` },
      { status: 409 },
    );
  }
  const { data, error } = await db.from("categories").update(patch).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, ignored_fudo_fields: ignored });
}

/** Borra la categoría y deja sus productos sin categoría (igual que `on delete set null`). */
export async function DELETE(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;

  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "id inválido." }, { status: 400 });

  const db = createAdminClient();
  const current = await db.from("categories").select("fudo_id").eq("id", id.data).maybeSingle();
  if (current.error) return NextResponse.json({ error: current.error.message }, { status: 500 });
  if (current.data?.fudo_id != null) {
    return NextResponse.json(
      { error: "Esta categoría viene de Fudo y volvería en la próxima sincronización. Borrala o desactivala en Fudo." },
      { status: 409 },
    );
  }
  await db.from("products").update({ category_id: null }).eq("category_id", id.data);
  const { error } = await db.from("categories").delete().eq("id", id.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
