import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { generateReply, loadAgentSettings, resolveLlm } from "@/lib/agent/reply";
import { TEST_PHONE } from "@/lib/agent/settings";
import type { ChatMessage } from "@/lib/agent/types";

const bodySchema = z.object({
  /** Conversación hasta ahora, terminando en el mensaje del cliente a responder. */
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) }))
    .min(1)
    .max(40),
});

/**
 * Prueba el agente sin WhatsApp. Lee el menú y cotiza con datos reales, pero no crea
 * pedidos, no cancela ni deriva conversaciones (dryRun), y no gasta mensajes de Meta.
 */
export async function POST(req: NextRequest) {
  const denied = await guardAdmin(req, 20);
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success || parsed.data.history.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Escribí un mensaje para probar." }, { status: 400 });
  }

  const db = createAdminClient();
  const settings = await loadAgentSettings(db);
  const llm = await resolveLlm(db, settings);
  if (!llm) {
    return NextResponse.json({ error: "Cargá la clave de OpenAI para probar el agente." }, { status: 400 });
  }

  const { data: existing } = await db.from("wa_conversations").select("*").eq("client_phone", TEST_PHONE).maybeSingle();
  const conversation =
    existing ??
    (await db.from("wa_conversations").insert({ client_phone: TEST_PHONE, contact_name: "Prueba" }).select().single()).data;
  if (!conversation) return NextResponse.json({ error: "No se pudo preparar la prueba." }, { status: 500 });

  try {
    const reply = await generateReply({
      db,
      llm,
      settings,
      conversation,
      messageId: crypto.randomUUID(),
      history: parsed.data.history as ChatMessage[],
      dryRun: true,
    });
    return NextResponse.json({ reply: reply.text, tokens: reply.tokens });
  } catch {
    return NextResponse.json({ error: "El agente no pudo responder. Revisá la clave de OpenAI." }, { status: 502 });
  }
}
