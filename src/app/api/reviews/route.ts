import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";

const ORDER_ID_REGEX = /^[A-Za-z0-9#-]{1,50}$/;
const MAX_FEEDBACK_LENGTH = 1000;

export async function POST(req: Request) {
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
    const body = await req.json() as { orderId?: unknown; rating?: unknown; feedback?: unknown };
    const { orderId, rating, feedback } = body;

    if (typeof orderId !== "string" || !ORDER_ID_REGEX.test(orderId)) {
      return NextResponse.json({ error: "orderId inválido" }, { status: 400 });
    }

    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json({ error: "rating debe ser entero entre 1 y 5" }, { status: 400 });
    }

    if (feedback !== undefined) {
      if (typeof feedback !== "string" || feedback.length > MAX_FEEDBACK_LENGTH) {
        return NextResponse.json({ error: "feedback demasiado largo" }, { status: 400 });
      }
    }

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
