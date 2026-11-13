import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { FUDO_MANAGED_CATEGORY_FIELDS, stripFudoManaged } from "@/lib/fudo/catalog-lock";
import { actorFromSession, dataFor, dualWrite } from "@/lib/data";
import { type Outcome, isSuccess, respond, serverError } from "@/lib/catalog/outcome";

const categoryFields = {
  name: z.string().trim().min(1, "El nombre es requerido").max(80),
  description: z.string().trim().max(300),
  is_active: z.boolean(),
  points_per_100: z.number().finite().min(0).max(1000).nullable(),
};

const categorySchema = z.object({
  ...categoryFields,
  description: categoryFields.description.default(""),
  is_active: categoryFields.is_active.default(true),
  points_per_100: categoryFields.points_per_100.default(null),
});

// Sin `.default()`: un PATCH parcial no debe pisar descripción, visibilidad ni puntos (ver /api/products).
const updateSchema = z.object(categoryFields).partial().extend({ id: z.string().uuid() });

const FUDO_LOCKED_MSG = (ignored: string[]) =>
  `Esta categoría se administra desde Fudo (${ignored.join(", ")}). Cambialo allá y se actualiza solo.`;
const FUDO_DELETE_MSG = "Esta categoría viene de Fudo y volvería en la próxima sincronización. Borrala o desactivala en Fudo.";

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
  const actor = actorFromSession({ userId: auth.user.id, role: auth.role });

  const parsed = categorySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error);

  // El id se genera acá para que Supabase y D1 guarden la misma fila.
  const id = crypto.randomUUID();
  try {
    const outcome = await dualWrite<Outcome>(
      "categories.create",
      async () => {
        const { data, error } = await createAdminClient().from("categories").insert({ id, ...parsed.data }).select().single();
        if (error) throw new Error(error.message);
        return { status: 201, body: data };
      },
      async () => ({ status: 201, body: await (await dataFor(actor)).catalogAdmin.createCategory(id, parsed.data) }),
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("categories.create", err);
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
      "categories.update",
      async () => {
        const db = createAdminClient();
        const current = await db.from("categories").select("fudo_id").eq("id", id).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        if (!current.data) return { status: 404, body: { error: "Categoría no encontrada." } };
        // El nombre de una categoría de Fudo lo manda Fudo: renombrarla acá sería pisado en la próxima sincronización.
        const { patch, ignored } = stripFudoManaged(requested, current.data.fudo_id ?? null, FUDO_MANAGED_CATEGORY_FIELDS);
        if (Object.keys(patch).length === 0) return { status: 409, body: { error: FUDO_LOCKED_MSG(ignored) } };
        const { data, error } = await db.from("categories").update(patch).eq("id", id).select().single();
        if (error) throw new Error(error.message);
        return { status: 200, body: { ...data, ignored_fudo_fields: ignored } };
      },
      async () => {
        const r = await (await dataFor(actor)).catalogAdmin.updateCategory(id, requested);
        if (r.status === "not_found") return { status: 404, body: { error: "Categoría no encontrada." } };
        if (r.status === "fudo_locked") return { status: 409, body: { error: FUDO_LOCKED_MSG(r.ignored) } };
        return { status: 200, body: { ...r.row, ignored_fudo_fields: r.ignored } };
      },
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("categories.update", err);
  }
}

/** Borra la categoría y deja sus productos sin categoría (igual que `on delete set null`). */
export async function DELETE(req: NextRequest) {
  if (!(await limited(req, 30))) return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return auth.error;
  const actor = actorFromSession({ userId: auth.user.id, role: auth.role });

  const id = z.string().uuid().safeParse(req.nextUrl.searchParams.get("id"));
  if (!id.success) return NextResponse.json({ error: "id inválido." }, { status: 400 });

  try {
    const outcome = await dualWrite<Outcome>(
      "categories.delete",
      async () => {
        const db = createAdminClient();
        const current = await db.from("categories").select("fudo_id").eq("id", id.data).maybeSingle();
        if (current.error) throw new Error(current.error.message);
        if (current.data?.fudo_id != null) return { status: 409, body: { error: FUDO_DELETE_MSG } };
        const unlink = await db.from("products").update({ category_id: null }).eq("category_id", id.data);
        if (unlink.error) throw new Error(unlink.error.message);
        const { error } = await db.from("categories").delete().eq("id", id.data);
        if (error) throw new Error(error.message);
        return { status: 200, body: { ok: true } };
      },
      async () => {
        const r = await (await dataFor(actor)).catalogAdmin.deleteCategory(id.data);
        if (r === "fudo_locked") return { status: 409, body: { error: FUDO_DELETE_MSG } };
        return { status: 200, body: { ok: true } };
      },
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("categories.delete", err);
  }
}
