import { NextResponse } from "next/server";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { isDemoMode } from "@/lib/demo/mode";
import { resetStore } from "@/lib/demo/store";

/** Restaura los datos de ejemplo originales (solo modo demo). */
export async function POST(req: Request) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  if (!isDemoMode()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  resetStore();
  return NextResponse.json({ ok: true });
}
