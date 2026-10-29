import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { rejectCrossOrigin } from "@/lib/auth/requireRole";

const MAX_FEEDBACK_LENGTH = 1000;

const reviewSchema = z.object({
  orderId: z.uuid("orderId inválido"),
  rating: z.number().int().min(1).max(5),
  feedback: z.string().max(MAX_FEEDBACK_LENGTH).optional(),
});

function zodErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Body inválido.";
}

export async function POST(req: Request) {
  const crossOrigin = rejectCrossOrigin(req);
  if (crossOrigin) return crossOrigin;

  // Autenticación requerida — no se aceptan reseñas anónimas
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await rateLimit(getClientIp(req), 10, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá en un momento." }, { status: 429 });
  }

  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const parsed = reviewSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: zodErrorMessage(parsed.error) }, { status: 400 });
    }
    const { orderId, rating, feedback } = parsed.data;

    // Ownership check: el pedido reseñado debe pertenecer al cliente
    // autenticado. Sin esto, cualquier usuario logueado podría enviar una
    // reseña (y potencialmente generar un ticket) para el pedido de otro
    // cliente adivinando/enumerando UUIDs (IDOR).
    const adminClient = createAdminClient();
    const { data: clientRow } = await adminClient
      .from("clients")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!clientRow) {
      return NextResponse.json({ error: "Cliente no encontrado." }, { status: 403 });
    }

    const { data: orderRow } = await adminClient
      .from("orders")
      .select("id, client_id, status")
      .eq("id", orderId)
      .maybeSingle();

    if (!orderRow || orderRow.client_id !== clientRow.id) {
      return NextResponse.json({ error: "No autorizado para reseñar este pedido." }, { status: 403 });
    }

    if (orderRow.status !== "Finalizados") {
      return NextResponse.json({ error: "Sólo se pueden reseñar pedidos entregados." }, { status: 409 });
    }

    // Una reseña por pedido. Si la tabla `reviews` todavía no existe en la
    // base (migración 004 pendiente) la consulta devuelve error y se sigue.
    const { data: existingReview } = await adminClient
      .from("reviews")
      .select("id")
      .eq("order_id", orderId)
      .limit(1);
    if ((existingReview ?? []).length > 0) {
      return NextResponse.json({ error: "Ya calificaste este pedido." }, { status: 409 });
    }

    await adminClient.from("reviews").insert({
      order_id: orderId,
      client_id: clientRow.id,
      rating,
      feedback: feedback?.trim() || null,
    });

    const webhookUrl = process.env.N8N_WEBHOOK_URL_REVIEWS;

    if (webhookUrl) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch(webhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: user.id, orderId, rating, feedback }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return NextResponse.json({ error: "Error al registrar la reseña" }, { status: 502 });
        }
      } finally {
        clearTimeout(timeoutId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "Timeout al registrar la reseña" }, { status: 504 });
    }
    console.error("Reviews API Error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
