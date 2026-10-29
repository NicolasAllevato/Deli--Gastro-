import { NextRequest, NextResponse, after } from "next/server";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { isDemoMode } from "@/lib/demo/mode";
import { demoGateway } from "@/lib/payments/gateway";
import { settlePayment } from "@/lib/payments/intents";
import { MP_CURRENCY } from "@/lib/payments/mercadopago";
import { notifyOrderEvent } from "@/lib/whatsapp/notify";

const bodySchema = z.object({ outcome: z.enum(["approved", "rejected"]) });

/**
 * Simulador de Mercado Pago (solo modo demo): resuelve una intención como si el cliente hubiera pagado
 * o el pago hubiera sido rechazado, pasando por la misma lógica que el webhook real.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  if (!isDemoMode()) return NextResponse.json({ error: "No encontrado." }, { status: 404 });

  const id = z.string().uuid().safeParse((await params).id);
  const body = bodySchema.safeParse(await req.json().catch(() => null));
  if (!id.success || !body.success) return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });

  const db = createAdminClient();
  const { data: intent } = await db.from("payment_intents").select("id, total").eq("id", id.data).maybeSingle();
  if (!intent) return NextResponse.json({ error: "Pago no encontrado." }, { status: 404 });

  const settled = await settlePayment(db, demoGateway(), intent.id, {
    id: `demo-${intent.id}`,
    status: body.data.outcome,
    transaction_amount: Number(intent.total),
    currency_id: MP_CURRENCY,
    external_reference: intent.id,
  });
  if (!settled.ok) return NextResponse.json({ error: settled.message }, { status: settled.status });

  if (settled.value.kind === "order_created") {
    const orderId = settled.value.order.id;
    after(() => notifyOrderEvent(db, orderId, "created"));
  }
  return NextResponse.json({ result: settled.value.kind });
}
