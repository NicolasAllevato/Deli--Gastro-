import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/utils/supabase/admin";
import { guardAdmin } from "@/lib/auth/adminGuard";
import { clientFor, loadWhatsAppSettings } from "@/lib/whatsapp/config";
import { WhatsAppApiError } from "@/lib/whatsapp/client";
import { OpenWAApiError, createOpenWAClient, isOpenWAProvider, openwaConfigFromEnv } from "@/lib/whatsapp/openwa";

const idSchema = z.string().uuid();
const patchSchema = z.object({ humanTakeover: z.boolean() }).strict();
const sendSchema = z.object({ text: z.string().trim().min(1, "Escribí un mensaje").max(1000) }).strict();

const THREAD_LIMIT = 100;
/** WhatsApp solo deja escribir texto libre durante las 24 h posteriores al último mensaje del cliente. */
const WINDOW_MS = 24 * 60 * 60 * 1000;

type Ctx = { params: Promise<{ id: string }> };

async function parseId(ctx: Ctx) {
  const id = idSchema.safeParse((await ctx.params).id);
  return id.success ? id.data : null;
}

const invalidId = () => NextResponse.json({ error: "Conversación inválida." }, { status: 400 });

/** Mensajes de una conversación, del más viejo al más nuevo. */
export async function GET(req: NextRequest, ctx: Ctx) {
  const denied = await guardAdmin(req, 120);
  if (denied) return denied;
  const id = await parseId(ctx);
  if (!id) return invalidId();

  const db = createAdminClient();
  const { data: conversation } = await db.from("wa_conversations").select("*").eq("id", id).maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404 });

  const { data: messages } = await db
    .from("wa_messages")
    .select("id, direction, type, body, status, tokens, created_at")
    .eq("conversation_id", id)
    .order("created_at", { ascending: false })
    .limit(THREAD_LIMIT);

  return NextResponse.json({
    conversation: { id, phone: conversation.client_phone, humanTakeover: conversation.human_takeover },
    messages: [...(messages ?? [])].reverse(),
  });
}

/** "Tomar el control": el agente deja de responder esta conversación (o vuelve a hacerlo). */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const denied = await guardAdmin(req, 60);
  if (denied) return denied;
  const id = await parseId(ctx);
  if (!id) return invalidId();

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Body inválido." }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("wa_conversations")
    .update({ human_takeover: parsed.data.humanTakeover })
    .eq("id", id)
    .select("id, human_takeover")
    .maybeSingle();
  if (error) return NextResponse.json({ error: "No se pudo actualizar la conversación." }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404 });
  return NextResponse.json({ id: data.id, humanTakeover: data.human_takeover });
}

/** Respuesta manual del local, dentro de la ventana de 24 h. */
export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await guardAdmin(req, 30);
  if (denied) return denied;
  const id = await parseId(ctx);
  if (!id) return invalidId();

  const parsed = sendSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Body inválido." }, { status: 400 });
  }

  const db = createAdminClient();
  const { data: conversation } = await db.from("wa_conversations").select("*").eq("id", id).maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversación no encontrada." }, { status: 404 });

  const lastInbound = conversation.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : 0;
  if (Date.now() - lastInbound > WINDOW_MS) {
    return NextResponse.json(
      { error: "Pasaron más de 24 h desde el último mensaje del cliente: solo se puede escribir con una plantilla." },
      { status: 409 },
    );
  }

  // Con WHATSAPP_PROVIDER=openwa la respuesta sale por el número conectado por QR (pruebas).
  const openwa = isOpenWAProvider() ? openwaConfigFromEnv() : null;
  const wa = openwa ? createOpenWAClient(openwa) : clientFor(await loadWhatsAppSettings(db));
  if (!wa) return NextResponse.json({ error: "Conectá WhatsApp primero." }, { status: 400 });

  try {
    const wamid = await wa.sendText(conversation.client_phone, parsed.data.text);
    await db.from("wa_messages").insert({
      conversation_id: id, wamid, direction: "out", type: "text", body: parsed.data.text,
    });
    return NextResponse.json({ ok: true });
  } catch (error: unknown) {
    const message = error instanceof WhatsAppApiError || error instanceof OpenWAApiError
      ? error.message
      : "No se pudo enviar el mensaje.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
