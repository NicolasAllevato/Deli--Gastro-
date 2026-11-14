import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { requireClient } from "@/lib/auth/requireClient";
import { isAuthorizationError } from "@/lib/auth/requireRole";

/**
 * Perfil del cliente autenticado (etapa 3): reemplaza las lecturas directas a `clients` y
 * `orders` que el navegador hacía con RLS de Supabase. Solo sus propios datos (client.id).
 */
export async function GET(req: NextRequest) {
  if (!(await rateLimit(getClientIp(req), 60, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 });
  }
  const auth = await requireClient(req);
  if (isAuthorizationError(auth)) return auth.error;

  const db = createAdminClient();
  const [{ data: client, error }, { count }] = await Promise.all([
    db.from("clients").select("id, name, phone, address, total_points, created_at").eq("id", auth.client.id).single(),
    db.from("orders").select("id", { count: "exact", head: true }).eq("client_id", auth.client.id),
  ]);
  if (error || !client) {
    console.error("[client] perfil", error?.message);
    return NextResponse.json({ error: "Error interno." }, { status: 500 });
  }
  return NextResponse.json({ email: auth.user.email ?? null, client, ordersTotal: count ?? 0 });
}
