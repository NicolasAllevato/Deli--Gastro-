import { NextResponse, type NextRequest } from "next/server";
import { listarReclamos } from "@/lib/reclamos/api";
import { adminActor, reclamosDeps, toResponse } from "@/lib/reclamos/default-deps";

/** Lista de reclamos con filtros (estado, categoria, desde, hasta) y conteo por categoría (30 días). Solo admin. */
export async function GET(req: NextRequest) {
  const actor = await adminActor(req, 60);
  if (actor instanceof NextResponse) return actor;
  return toResponse(await listarReclamos(actor, new URL(req.url).searchParams, reclamosDeps));
}
