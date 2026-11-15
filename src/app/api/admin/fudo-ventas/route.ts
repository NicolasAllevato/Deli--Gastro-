import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { actorFromSession, dataFor, usesD1 } from "@/lib/data";
import { requireRole, isAuthorizationError } from "@/lib/auth/requireRole";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { fudoWriteGateway } from "@/lib/fudo/sales-gateway";

// Ventas en Fudo de pedidos de la app/WhatsApp que quedaron pendientes (escrituras apagadas o Fudo caído).
// Solo admin. GET: lista. POST { orderId }: reintenta (idempotente: nunca crea dos ventas para un pedido).

const retrySchema = z.object({ orderId: z.string().uuid() });

async function adminData(req: NextRequest, perMinute: number) {
  if (!(await rateLimit(getClientIp(req), perMinute, 60_000))) {
    return { error: NextResponse.json({ error: "Demasiadas solicitudes." }, { status: 429 }) };
  }
  const auth = await requireRole("admin", req);
  if (isAuthorizationError(auth)) return { error: auth.error };
  if (!usesD1()) return { error: NextResponse.json({ error: "Disponible solo con D1 como fuente de datos." }, { status: 409 }) };
  return { data: await dataFor(actorFromSession({ userId: auth.user.id, role: auth.role })) };
}

export async function GET(req: NextRequest) {
  const r = await adminData(req, 30);
  if ("error" in r) return r.error;
  return NextResponse.json({ pending: await r.data.fudoSales.pending() });
}

export async function POST(req: NextRequest) {
  const r = await adminData(req, 10);
  if ("error" in r) return r.error;
  const parsed = retrySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  const outcome = await r.data.fudoSales.retry(fudoWriteGateway(), parsed.data.orderId);
  return NextResponse.json(outcome);
}
