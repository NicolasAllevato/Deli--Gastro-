import { NextRequest, NextResponse } from "next/server";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { requestCatalogSync } from "@/lib/fudo/gateway";

// Sincroniza a pedido el catálogo de Fudo (productos, categorías, precios). Lo hace el Worker `fudo-gateway`.
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 6);
  if (denied) return denied;
  const outcome = await requestCatalogSync();
  if (!outcome.ok) {
    console.warn("[admin/fudo-sync]", outcome.error);
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }
  return NextResponse.json(outcome.summary);
}
