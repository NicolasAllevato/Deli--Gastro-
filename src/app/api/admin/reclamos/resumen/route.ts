import { NextResponse, type NextRequest } from "next/server";
import { resumenReclamosApi } from "@/lib/reclamos/api";
import { adminActor, reclamosDeps, toResponse } from "@/lib/reclamos/default-deps";

/** Contadores para el aviso del panel: abiertos, en curso y vencidos (SLA de 2 h con el local abierto). Solo admin. */
export async function GET(req: NextRequest) {
  const actor = await adminActor(req, 120);
  if (actor instanceof NextResponse) return actor;
  return toResponse(await resumenReclamosApi(actor, reclamosDeps));
}
