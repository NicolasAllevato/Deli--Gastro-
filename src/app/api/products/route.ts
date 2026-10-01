import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";

// Imagen: vacía, URL https (R2) o data URL (modo demo, sin R2).
const MAX_DATA_URL_LENGTH = 7_000_000;
const imageSchema = z
  .string()
  .max(MAX_DATA_URL_LENGTH)
  .refine((v) => v === "" || v.startsWith("https://") || v.startsWith("data:image/"), {
    message: "Imagen inválida",
  });

const categoryIdSchema = z
  .union([z.string().uuid(), z.literal(""), z.null()])
  .transform((v) => (v === "" ? null : v));

const productSchema = z.object({
  name: z.string().trim().min(1, "El nombre es requerido").max(120),
  description: z.string().trim().max(500).default(""),
  price: z.number().finite().nonnegative().max(10_000_000),
  image_url: imageSchema.default(""),
  category_id: categoryIdSchema.default(null),
  is_active: z.boolean().default(true),
});

const updateSchema = productSchema.partial().extend({ id: z.string().uuid() });

function limited(req: NextRequest, max: number) {
  return rateLimit(getClientIp(req), max, 60_000);
}

function fail(error: z.ZodError) {
  return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
}

/** Catálogo completo (incluye inactivos) para el panel admin. */
export async function GET(req: NextRequest) {
  if (!(await limited(req, 120))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const db = createAdminClient();
  const [products, categories] = await Promise.all([
    db.from("products").select("*").order("created_at", { ascending: false }),
    db.from("categories").select("*").order("created_at", { ascending: true }),
  ]);
  if (products.error) return NextResponse.json({ error: products.error.message }, { status: 500 });
  if (categories.error) return NextResponse.json({ error: categories.error.message }, { status: 500 });
  return NextResponse.json({ products: products.data, categories: categories.data });
}

export async function POST(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const parsed = productSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  const { data, error } = await createAdminClient().from("products").insert(parsed.data).select().single();
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
    .from("products")
    .update(patch)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin");
  if (isAuthorizationError(auth)) return auth.error;

  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "id inválido." }, { status: 400 });

  const { error } = await createAdminClient().from("products").delete().eq("id", id.data);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
