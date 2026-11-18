import { NextResponse, type NextRequest } from "next/server";
import { accionReclamo, detalleReclamo } from "@/lib/reclamos/api";
import { adminActor, reclamosDeps, toResponse } from "@/lib/reclamos/default-deps";

type Ctx = { params: Promise<{ id: string }> };

/** Detalle con historial y pedido vinculado. Solo admin. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const actor = await adminActor(req, 120);
  if (actor instanceof NextResponse) return actor;
  return toResponse(await detalleReclamo(actor, (await ctx.params).id, reclamosDeps));
}

/** Acciones: tomar, reabrir, nota, responder, resolver. Solo admin. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const actor = await adminActor(req, 30);
  if (actor instanceof NextResponse) return actor;
  return toResponse(await accionReclamo(actor, (await ctx.params).id, await req.json().catch(() => null), reclamosDeps));
}
