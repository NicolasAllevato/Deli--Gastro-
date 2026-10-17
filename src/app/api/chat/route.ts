import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { rateLimit, getClientIp } from "@/utils/rate-limit";
import { isDemoMode } from "@/lib/demo/mode";
import { buildDemoReply } from "@/lib/demo/chatbot";

const MAX_MESSAGE_LENGTH = 2000;

const chatSchema = z.object({
  message: z.string().trim().min(1, "Message is required").max(MAX_MESSAGE_LENGTH, "Message too long"),
  clientId: z.string().max(100).optional(),
});

function isValidN8nReply(data: unknown): data is { reply: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "reply" in data &&
    typeof (data as Record<string, unknown>).reply === "string"
  );
}

export async function POST(req: Request) {
  // Autenticación requerida
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await rateLimit(getClientIp(req), 30, 60_000))) {
    return NextResponse.json({ error: "Demasiadas solicitudes. Intentá en un momento." }, { status: 429 });
  }

  try {
    let rawBody: unknown;
    try {
      rawBody = await req.json();
    } catch {
      return NextResponse.json({ error: "Body inválido." }, { status: 400 });
    }

    const parsed = chatSchema.safeParse(rawBody);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid body" }, { status: 400 });
    }
    const { message } = parsed.data;

    const n8nWebhookUrl = process.env.N8N_WEBHOOK_URL_CHATBOT;

    if (n8nWebhookUrl) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch(n8nWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clientId: user.id, message }),
          signal: controller.signal,
        });

        if (!response.ok) {
          return NextResponse.json({ error: "Error al contactar el asistente" }, { status: 502 });
        }

        let n8nData: unknown;
        try {
          n8nData = await response.json();
        } catch {
          return NextResponse.json({ error: "Respuesta inválida del asistente" }, { status: 502 });
        }

        if (!isValidN8nReply(n8nData)) {
          return NextResponse.json({ error: "Respuesta inesperada del asistente" }, { status: 502 });
        }

        return NextResponse.json({ reply: n8nData.reply });
      } finally {
        clearTimeout(timeoutId);
      }
    }

    if (isDemoMode()) {
      return NextResponse.json({ reply: await buildDemoReply(user.id, message) });
    }

    return NextResponse.json({ reply: "Hola, soy el asistente virtual de Deli-Gastro. (Conectá n8n para activarme)" });

  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return NextResponse.json({ error: "El asistente tardó demasiado. Intentá de nuevo." }, { status: 504 });
    }
    console.error("Chat API Error:", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
