import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { kbApp, kbInputSchema, KB_MAX_ROWS } from "@/lib/data";
import { guard } from "./guard";

const patchSchema = kbInputSchema.partial().extend({ id: z.string().uuid() }).strict();
const deleteSchema = z.object({ id: z.string().uuid() }).strict();

function badRequest(error: z.ZodError) {
  return NextResponse.json({ error: error.issues[0]?.message ?? "Datos inválidos." }, { status: 400 });
}

function serverError(op: string, err: unknown) {
  console.error(`[conocimiento] ${op}`, err instanceof Error ? err.message : err);
  return NextResponse.json({ error: "No se pudo completar la operación." }, { status: 500 });
}

export async function GET(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  try {
    return NextResponse.json({ entries: await kbApp.list(actor), limit: KB_MAX_ROWS });
  } catch (err) {
    return serverError("list", err);
  }
}

export async function POST(req: NextRequest) {
  const { denied, actor } = await guard(req, 30);
  if (denied || !actor) return denied;
  const parsed = kbInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    return NextResponse.json(await kbApp.create(actor, parsed.data), { status: 201 });
  } catch (err) {
    return serverError("create", err);
  }
}

export async function PATCH(req: NextRequest) {
  const { denied, actor } = await guard(req, 60);
  if (denied || !actor) return denied;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  const { id, ...changes } = parsed.data;
  if (Object.keys(changes).length === 0) return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });
  try {
    const row = await kbApp.update(actor, id, changes);
    return row ? NextResponse.json(row) : NextResponse.json({ error: "Entrada no encontrada." }, { status: 404 });
  } catch (err) {
    return serverError("update", err);
  }
}

export async function DELETE(req: NextRequest) {
  const { denied, actor } = await guard(req, 30);
  if (denied || !actor) return denied;
  const parsed = deleteSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return badRequest(parsed.error);
  try {
    await kbApp.remove(actor, parsed.data.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return serverError("delete", err);
  }
}
