import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { stripFudoManaged } from "@/lib/fudo/catalog-lock";
import { actorFromSession, comparableCategory, comparableProduct, dataFor, dualWrite, shadowRead } from "@/lib/data";
import { type Outcome, isSuccess, respond, serverError } from "@/lib/catalog/outcome";
import { publishProductChange } from "@/lib/gambeta/publish-server";

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

const productFields = {
  name: z.string().trim().min(1, "El nombre es requerido").max(120),
  description: z.string().trim().max(500),
  price: z.number().finite().nonnegative().max(10_000_000),
  image_url: imageSchema,
  category_id: categoryIdSchema,
  is_active: z.boolean(),
  /** Interruptor del admin "Visible en el portal". No lo maneja Fudo: se puede cambiar en productos de Fudo. */
  show_in_portal: z.boolean(),
  points_per_100: z.number().finite().min(0).max(1000).nullable(),
};

/** Supabase (congelado desde el corte a D1) no tiene la columna show_in_portal: no se le manda. */
function withoutPortalFlag<T extends { show_in_portal?: boolean }>(row: T): Omit<T, "show_in_portal"> {
  const { show_in_portal: _omit, ...rest } = row;
  void _omit;
  return rest;
}

const productSchema = z.object({
  ...productFields,
  description: productFields.description.default(""),
  image_url: productFields.image_url.default(""),
  category_id: productFields.category_id.default(null),
  is_active: productFields.is_active.default(true),
  show_in_portal: productFields.show_in_portal.default(true),
  points_per_100: productFields.points_per_100.default(null),
});

// Sin `.default()`: un PATCH parcial (por ejemplo solo `is_active`) no debe pisar foto ni descripción.
// Zod aplica los defaults aunque el campo sea opcional, por eso no se usa `productSchema.partial()`.
const updateSchema = z.object(productFields).partial().extend({ id: z.string().uuid() });

const FUDO_LOCKED_MSG = (ignored: string[]) =>
  `Este producto se administra desde Fudo (${ignored.join(", ")}). Cambialo allá y se actualiza solo.`;
const FUDO_DELETE_MSG = "Este producto viene de Fudo y volvería en la próxima sincronización. Desactivalo o borralo en Fudo.";

function limited(req: NextRequest, max: number) {
  return rateLimit(getClientIp(req), max, 60_000);
}

function fail(error: z.ZodError) {
  return NextResponse.json({ error: error.issues.map((i) => i.message).join("; ") }, { status: 400 });
}

/**
 * Catálogo completo (incluye inactivos) para el panel admin. Con DATA_BACKEND=dual
 * compara productos y categorías con D1 (sombra) sin cambiar la respuesta.
 */
export async function GET(req: NextRequest) {
  if (!(await limited(req, 120))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;
  const actor = actorFromSession({ userId: auth.user.id, role: auth.role });

  try {
    const [products, categories] = await Promise.all([
      shadowRead(
        async () => {
          const { data, error } = await createAdminClient().from("products").select("*").order("created_at", { ascending: false });
          if (error) throw new Error(error.message);
          return data ?? [];
        },
        async () => (await dataFor(actor)).catalogAdmin.products(),
        { op: "products.list", normalize: comparableProduct, normalizeShadow: comparableProduct, key: (r) => String(r.id) },
      ),
      shadowRead(
        async () => {
          const { data, error } = await createAdminClient().from("categories").select("*").order("created_at", { ascending: true });
          if (error) throw new Error(error.message);
          return data ?? [];
        },
        async () => (await dataFor(actor)).catalogAdmin.categories(),
        { op: "categories.list", normalize: comparableCategory, normalizeShadow: comparableCategory, key: (r) => String(r.id) },
      ),
    ]);
    return NextResponse.json({ products, categories });
  } catch (err) {
    return serverError("products.list", err);
  }
}

export async function POST(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;
  const actor = actorFromSession({ userId: auth.user.id, role: auth.role });

  const parsed = productSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  // El id se genera acá para que Supabase y D1 guarden la misma fila.
  const id = crypto.randomUUID();
  try {
    const outcome = await dualWrite<Outcome>(
      "products.create",
      async () => {
        const { data, error } = await createAdminClient().from("products").insert({ id, ...withoutPortalFlag(parsed.data) }).select().single();
        if (error) throw new Error(error.message);
        return { status: 201, body: data };
      },
      async () => ({ status: 201, body: await (await dataFor(actor)).catalogAdmin.createProduct(id, parsed.data) }),
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("products.create", err);
  }
}

export async function PATCH(req: NextRequest) {
  if (!(await limited(req, 60))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;
  const actor = actorFromSession({ userId: auth.user.id, role: auth.role });

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);
  const { id, ...requested } = parsed.data;

  try {
    const outcome = await dualWrite<Outcome>(
      "products.update",
      async () => {
        const db = createAdminClient();
        const current = await db.from("products").select("fudo_id").eq("id", id).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        if (!current.data) return { status: 404, body: { error: "Producto no encontrado." } };
        // Nombre, precio, disponibilidad y categoría los manda Fudo: editarlos acá sería pisado en la próxima sincronización.
        const { patch, ignored } = stripFudoManaged(withoutPortalFlag(requested), (current.data as { fudo_id: number | null }).fudo_id ?? null);
        if (Object.keys(patch).length === 0) return { status: 409, body: { error: FUDO_LOCKED_MSG(ignored) } };
        const { data, error } = await db.from("products").update(patch).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        return { status: 200, body: { ...data, ignored_fudo_fields: ignored } };
      },
      async () => {
        const r = await (await dataFor(actor)).catalogAdmin.updateProduct(id, requested);
        if (r.status === "not_found") return { status: 404, body: { error: "Producto no encontrado." } };
        if (r.status === "fudo_locked") return { status: 409, body: { error: FUDO_LOCKED_MSG(r.ignored) } };
        return { status: 200, body: { ...r.row, ignored_fudo_fields: r.ignored } };
      },
      { shouldMirror: isSuccess },
    );
    // Si el producto está vinculado con el sitio web, el cambio se publica en segundo plano (no demora la respuesta).
    if (outcome && isSuccess(outcome)) publishProductChange(id);
    return respond(outcome);
  } catch (err) {
    return serverError("products.update", err);
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;
  const actor = actorFromSession({ userId: auth.user.id, role: auth.role });

  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "id inválido." }, { status: 400 });

  try {
    const outcome = await dualWrite<Outcome>(
      "products.delete",
      async () => {
        const db = createAdminClient();
        const current = await db.from("products").select("fudo_id").eq("id", id.data).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        if ((current.data as { fudo_id: number | null } | null)?.fudo_id != null) {
          return { status: 409, body: { error: FUDO_DELETE_MSG } };
        }
        const { error } = await db.from("products").delete().eq("id", id.data);
        if (error) throw new Error(error.message);
        return { status: 200, body: { ok: true } };
      },
      async () => {
        const r = await (await dataFor(actor)).catalogAdmin.deleteProduct(id.data);
        if (r === "fudo_locked") return { status: 409, body: { error: FUDO_DELETE_MSG } };
        // Borrar algo que no existe es idempotente, igual que en Supabase.
        return { status: 200, body: { ok: true } };
      },
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("products.delete", err);
  }
}
