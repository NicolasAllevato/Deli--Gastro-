import { NextResponse } from "next/server";
import { isDemoMode } from "@/lib/demo/mode";
import { resetStore } from "@/lib/demo/store";

/** Restaura los datos de ejemplo originales (solo modo demo). */
export async function POST() {
  if (!isDemoMode()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  resetStore();
  return NextResponse.json({ ok: true });
}
