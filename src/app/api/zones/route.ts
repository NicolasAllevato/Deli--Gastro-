import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { actorFromSession, dataFor, dualWrite } from "@/lib/data";
import { type Outcome, isSuccess, respond, serverError } from "@/lib/catalog/outcome";
import { readConfig } from "@/lib/orders-server";
import { listZones, localFromConfig, zoneInputSchema } from "@/lib/zones-server";

const patchSchema = zoneInputSchema.partial().extend({ id: z.string().uuid() }).strict();
const deleteSchema = z.object({ id: z.string().uuid() });

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Body inválido.";
}

async function guard(req: NextRequest, limit: number) {
  if (!(await rateLimit(getClientIp(req), limit, 60_000))) {
    return { denied: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }), actor: null };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { denied: auth.error, actor: null };
  return { denied: null, actor: actorFromSession({ userId: auth.user.id, role: auth.role }) };
}

export async function GET(req: NextRequest) {
  const { denied } = await guard(req, 60);
  if (denied) return denied;
  const db = createAdminClient();
  const [zones, config] = await Promise.all([listZones(db), readConfig(db)]);
  return NextResponse.json({ zones, local: localFromConfig(config) });
}

export async function POST(req: NextRequest) {
  const { denied, actor } = await guard(req, 30);
  if (denied || !actor) return denied;

  const parsed = zoneInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  // El id se genera acá para que Supabase y D1 guarden la misma fila.
  const id = crypto.randomUUID();
  try {
    const outcome = await dualWrite<Outcome>(
      "zones.create",
      async () => {
        const { data, error } = await createAdminClient().from("delivery_zones").insert({ id, ...parsed.data }).select().single();
        if (error) throw new Error(error.message);
        return { status: 201, body: data };
      },
      async () => ({ status: 201, body: await (await dataFor(actor)).zones.create(id, parsed.data) }),
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("zones.create", err);
  }
}

export async function PATCH(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  const { id, ...changes } = parsed.data;
  if (Object.keys(changes).length === 0) {
    return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });
  }

  try {
    const outcome = await dualWrite<Outcome>(
      "zones.update",
      async () => {
        const { data, error } = await createAdminClient().from("delivery_zones").update(changes).eq("id", id).select().maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return { status: 404, body: { error: "Zona no encontrada." } };
        return { status: 200, body: data };
      },
      async () => {
        const row = await (await dataFor(actor)).zones.update(id, changes);
        return row ? { status: 200, body: row } : { status: 404, body: { error: "Zona no encontrada." } };
      },
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("zones.update", err);
  }
}

export async function DELETE(req: NextRequest) {
  const { denied, actor } = await guard(req, 30);
  if (denied || !actor) return denied;

  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: firstIssue(parsed.error) }, { status: 400 });

  try {
    const outcome = await dualWrite<Outcome>(
      "zones.delete",
      async () => {
        const { error } = await createAdminClient().from("delivery_zones").delete().eq("id", parsed.data.id);
        if (error) throw new Error(error.message);
        return { status: 200, body: { ok: true } };
      },
      async () => {
        await (await dataFor(actor)).zones.remove(parsed.data.id);
        return { status: 200, body: { ok: true } };
      },
      { shouldMirror: isSuccess },
    );
    return respond(outcome);
  } catch (err) {
    return serverError("zones.delete", err);
  }
}