import { NextResponse } from "next/server";
import { z } from "zod";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { simulateFudoChange } from "@/lib/demo/fudo-fixture";

const bodySchema = z.object({ kind: z.enum(["precios", "nuevo", "apagar"]) });

/** Edita algo en el Fudo simulado, como si alguien lo hubiera cambiado en Fudo (solo modo demo). */
export async function POST(req: Request) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  if (!isDemoMode()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Cambio inválido." }, { status: 400 });
  return NextResponse.json(simulateFudoChange(parsed.data.kind));
}
